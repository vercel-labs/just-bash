/**
 * Secure fetch wrapper with allow-list enforcement
 *
 * This module provides a fetch wrapper that:
 * 1. Enforces URL allow-list at the fetch layer (not subject to parsing)
 * 2. Handles redirects manually to check each redirect target against the allow-list
 * 3. Provides timeout support
 */

import { lookup as dnsLookup } from "node:dns";
import { combineAbortSignals } from "../abort-signals.js";
import { DefenseInDepthBox } from "../security/defense-in-depth-box.js";
import { _clearTimeout, _setTimeout } from "../timers.js";
import {
  isPrivateIp,
  isUrlAllowed,
  matchesAllowListEntry,
  validateAllowList,
} from "./allow-list.js";
import {
  createPinnedConnectionOwner,
  DnsPinningUnavailableError,
  type PinnedAddress,
  type PinnedConnectionOwner,
} from "./dns-pin.js";
import type { AllowedUrl, AllowedUrlEntry, DnsLookupResult } from "./types.js";
import {
  type FetchResult,
  type HttpMethod,
  MethodNotAllowedError,
  NetworkAccessDeniedError,
  type NetworkConfig,
  RedirectNotAllowedError,
  ResponseTooLargeError,
  TooManyRedirectsError,
} from "./types.js";

// DNS resolution for private IP check
function dnsLookupAll(hostname: string): Promise<DnsLookupResult[]> {
  return new Promise<DnsLookupResult[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

const DEFAULT_MAX_REDIRECTS = 20;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_SIZE = 10485760; // 10MB
const DEFAULT_ALLOWED_METHODS: HttpMethod[] = ["GET", "HEAD"];

/**
 * HTTP methods that should not have a body
 */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Redirect status codes
 */
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    // The operation may already have started before its promise reached this
    // helper (DNS and dispatcher disposal are examples). Observe a later
    // rejection while returning the cancellation immediately.
    void promise.catch(() => undefined);
    throw abortReason(signal);
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Await a request-owned transport without leaking an owner that is created
 * after cancellation wins the race. A factory cannot always be cancelled
 * while it imports/initializes its connector, so late fulfillment must carry
 * its own disposal continuation.
 */
async function awaitConnectionOwner(
  promise: Promise<PinnedConnectionOwner>,
  signal: AbortSignal | undefined,
): Promise<PinnedConnectionOwner> {
  try {
    return await awaitWithSignal(promise, signal);
  } catch (error) {
    if (signal?.aborted) {
      void promise
        .then((owner) => DefenseInDepthBox.runTrustedAsync(() => owner.close()))
        .catch(() => undefined);
    }
    throw error;
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body && !response.body.locked) {
    await response.body.cancel();
  }
}

export interface SecureFetchOptions {
  method?: string;
  headers?: Headers | Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  /** Override timeout for this request (capped at global timeout) */
  timeoutMs?: number;
  /** Override redirects for this request (capped at the host policy). */
  maxRedirects?: number;
  /** Abort DNS review, redirects, transport, and response-body consumption. */
  signal?: AbortSignal;
}

/**
 * Type for the secure fetch function
 */
export type SecureFetch = (
  url: string,
  options?: SecureFetchOptions,
) => Promise<FetchResult>;

/**
 * Creates a secure fetch function that enforces the allow-list.
 */
export function createSecureFetch(config: NetworkConfig): SecureFetch {
  const entries: AllowedUrlEntry[] = config.allowedUrlPrefixes ?? [];

  // Fail fast on invalid allow-list entries
  if (!config.dangerouslyAllowFullInternetAccess) {
    const errors = validateAllowList(entries);
    if (errors.length > 0) {
      throw new Error(`Invalid network allow-list:\n${errors.join("\n")}`);
    }
  }

  // Collect entries that carry transforms for firewall header injection.
  const transformEntries: AllowedUrl[] = [];
  for (const entry of entries) {
    if (
      typeof entry === "object" &&
      entry.transform &&
      entry.transform.length > 0
    ) {
      transformEntries.push(entry);
    }
  }

  /**
   * Returns firewall headers for a given URL by matching against transform
   * entries using URL prefix matching (same logic as the allow-list).
   *
   * When multiple entries match (overlapping prefixes), later entries
   * override earlier ones for the same header name via `set()`. This
   * means a path-specific `Authorization` overrides an origin-wide one.
   */
  function getFirewallHeaders(url: string): Headers | null {
    if (transformEntries.length === 0) return null;
    let merged: Headers | null = null;
    for (const entry of transformEntries) {
      if (matchesAllowListEntry(url, entry.url) && entry.transform) {
        if (!merged) merged = new Headers();
        for (const t of entry.transform) {
          for (const [key, value] of Object.entries(t.headers)) {
            merged.set(key, value);
          }
        }
      }
    }
    return merged;
  }

  if (
    config.maxRedirects !== undefined &&
    (!Number.isSafeInteger(config.maxRedirects) || config.maxRedirects < 0)
  ) {
    throw new RangeError("maxRedirects must be a non-negative safe integer");
  }
  const maxRedirects = config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseSize = config.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE;
  const allowedMethods = config.dangerouslyAllowFullInternetAccess
    ? ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
    : (config.allowedMethods ?? DEFAULT_ALLOWED_METHODS);
  // Default to denying private ranges in production
  const denyPrivateRanges =
    config.denyPrivateRanges ??
    (typeof process !== "undefined" && process.env?.NODE_ENV === "production");
  const resolveDns = config._dnsResolve ?? dnsLookupAll;
  const createConnectionOwner =
    config._createConnectionOwner ?? createPinnedConnectionOwner;

  function addressFamily(address: string): 4 | 6 | null {
    const normalized =
      address.startsWith("[") && address.endsWith("]")
        ? address.slice(1, -1)
        : address;
    const validIpv4 =
      /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(normalized) &&
      normalized.split(".").every((part) => Number(part) <= 255);
    if (validIpv4) return 4;

    if (normalized.includes(":") && !normalized.includes("%")) {
      try {
        if (new URL(`http://[${normalized}]/`).hostname.length > 2) return 6;
      } catch {
        // Invalid IPv6 address.
      }
    }
    return null;
  }

  function validatedPinnedAddress(
    url: string,
    hostname: string,
    result: DnsLookupResult,
  ): PinnedAddress {
    const { address, family } = result;
    if (addressFamily(address) !== family) {
      throw new NetworkAccessDeniedError(
        url,
        "DNS returned an invalid address for private IP check",
      );
    }

    return { hostname, address, family };
  }

  /**
   * Checks if a URL is allowed by the configuration and, when
   * denyPrivateRanges is on, returns the validated DNS result so the
   * actual fetch can be pinned to that exact address (defeats DNS
   * rebinding between the preflight check and connection).
   *
   * @throws NetworkAccessDeniedError if the URL is not allowed
   */
  async function checkAllowed(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<PinnedAddress | null> {
    throwIfAborted(signal);
    if (
      !config.dangerouslyAllowFullInternetAccess &&
      !isUrlAllowed(url, entries)
    ) {
      throw new NetworkAccessDeniedError(url);
    }

    if (!denyPrivateRanges) return null;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new NetworkAccessDeniedError(url, "invalid URL");
    }

    // Private IP check still runs when full internet access is enabled.
    if (isPrivateIp(parsed.hostname)) {
      throw new NetworkAccessDeniedError(
        url,
        "private/loopback IP address blocked",
      );
    }

    // Public IP literals already name the exact connection address and cannot
    // be rebound. Every domain name must resolve successfully and be pinned.
    const hostname = parsed.hostname;
    if (addressFamily(hostname) !== null) return null;

    let addresses: DnsLookupResult[];
    try {
      addresses = await awaitWithSignal(resolveDns(hostname), signal);
    } catch {
      if (signal?.aborted) throw abortReason(signal);
      // Negative answers are not safe: proceeding would cause a second,
      // unrestricted lookup during connection establishment.
      throw new NetworkAccessDeniedError(
        url,
        "DNS resolution failed for private IP check",
      );
    }

    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new NetworkAccessDeniedError(
        url,
        "DNS resolution returned no addresses for private IP check",
      );
    }

    const validated = addresses.map((result) =>
      validatedPinnedAddress(url, hostname, result),
    );
    for (const { address } of validated) {
      if (isPrivateIp(address)) {
        throw new NetworkAccessDeniedError(
          url,
          "hostname resolves to private/loopback IP address",
        );
      }
    }
    return validated[0];
  }

  /**
   * Checks if an HTTP method is allowed by the configuration.
   * @throws MethodNotAllowedError if the method is not allowed
   */
  function checkMethodAllowed(method: string): void {
    if (config.dangerouslyAllowFullInternetAccess) {
      return;
    }

    const upperMethod = method.toUpperCase();
    if (!allowedMethods.includes(upperMethod as HttpMethod)) {
      throw new MethodNotAllowedError(upperMethod, allowedMethods);
    }
  }

  /**
   * Performs a fetch with allow-list enforcement and manual redirect handling.
   */
  async function secureFetch(
    url: string,
    options: SecureFetchOptions = {},
  ): Promise<FetchResult> {
    const method = options.method?.toUpperCase() ?? "GET";
    const followRedirects = options.followRedirects ?? true;
    if (
      options.maxRedirects !== undefined &&
      (!Number.isSafeInteger(options.maxRedirects) || options.maxRedirects < 0)
    ) {
      throw new RangeError("maxRedirects must be a non-negative safe integer");
    }
    const requestMaxRedirects = options.maxRedirects ?? maxRedirects;
    const effectiveMaxRedirects = Math.min(maxRedirects, requestMaxRedirects);

    // Use per-request timeout if specified, but cap at global timeout
    const effectiveTimeout =
      options.timeoutMs !== undefined
        ? Math.min(options.timeoutMs, timeoutMs)
        : timeoutMs;
    const timeoutController = new AbortController();
    const timeoutId = _setTimeout(
      () =>
        timeoutController.abort(
          new DOMException("The operation was aborted", "AbortError"),
        ),
      effectiveTimeout,
    );
    const combinedAbort = combineAbortSignals(
      options.signal,
      timeoutController.signal,
    );

    try {
      // One deadline covers DNS review, all redirect hops, body consumption,
      // and transport disposal. Redirects never receive a fresh allowance.
      let pinned = await checkAllowed(url, combinedAbort.signal);
      checkMethodAllowed(method);

      let currentUrl = url;
      let redirectCount = 0;

      while (true) {
        throwIfAborted(combinedAbort.signal);
        let connectionOwner: PinnedConnectionOwner | undefined;

        try {
          // Header construction and the Node-only connector import may touch
          // protected host intrinsics, so keep them in the trusted boundary.
          const response = await DefenseInDepthBox.runTrustedAsync(async () => {
            const firewallHeaders = getFirewallHeaders(currentUrl);
            const mergedHeaders = buildMergedHeaders(
              options.headers,
              firewallHeaders,
            );
            const fetchOptions: RequestInit = {
              method,
              headers: mergedHeaders,
              signal: combinedAbort.signal,
              redirect: "manual",
            };

            if (options.body && !BODYLESS_METHODS.has(method)) {
              fetchOptions.body = options.body;
            }

            if (!pinned) {
              // @banned-pattern-ignore: audited no-pin branch is reachable only when private-range denial is disabled
              return await awaitWithSignal(
                fetch(currentUrl, fetchOptions),
                combinedAbort.signal,
              );
            }

            try {
              connectionOwner = await awaitConnectionOwner(
                createConnectionOwner(pinned),
                combinedAbort.signal,
              );
              return await awaitWithSignal(
                connectionOwner.fetch(currentUrl, fetchOptions),
                combinedAbort.signal,
              );
            } catch (error) {
              if (error instanceof DnsPinningUnavailableError) {
                throw new NetworkAccessDeniedError(
                  currentUrl,
                  "DNS pinning unavailable for private IP enforcement",
                );
              }
              throw error;
            }
          });

          if (REDIRECT_CODES.has(response.status) && followRedirects) {
            const location = response.headers.get("location");
            if (!location) {
              return await responseToResult(
                response,
                currentUrl,
                maxResponseSize,
                combinedAbort.signal,
              );
            }

            const redirectUrl = new URL(location, currentUrl).href;
            // Do not leave a redirect body or connection live while reviewing
            // the next address.
            await awaitWithSignal(
              cancelResponseBody(response),
              combinedAbort.signal,
            );
            try {
              pinned = await checkAllowed(redirectUrl, combinedAbort.signal);
            } catch {
              if (combinedAbort.signal?.aborted) {
                throw abortReason(combinedAbort.signal);
              }
              throw new RedirectNotAllowedError(redirectUrl);
            }

            redirectCount++;
            if (redirectCount > effectiveMaxRedirects) {
              throw new TooManyRedirectsError(effectiveMaxRedirects);
            }

            currentUrl = redirectUrl;
            continue;
          }

          return await responseToResult(
            response,
            currentUrl,
            maxResponseSize,
            combinedAbort.signal,
          );
        } finally {
          if (connectionOwner) {
            const owner = connectionOwner;
            const closePromise = DefenseInDepthBox.runTrustedAsync(() =>
              owner.close(),
            );
            await awaitWithSignal(closePromise, combinedAbort.signal);
          }
        }
      }
    } finally {
      _clearTimeout(timeoutId);
      combinedAbort.cleanup();
    }
  }

  return secureFetch;
}

/**
 * Merges user headers with firewall headers.
 *
 * Accepts both `Headers` and plain `Record<string, string>` for backward
 * compatibility. User headers are copied first, then firewall headers are
 * `set()` on top so they always override — the sandbox cannot substitute
 * credentials. Multi-value user headers (added via `Headers.append()`)
 * are preserved for names that the firewall does not override.
 */
function buildMergedHeaders(
  userHeaders: Headers | Record<string, string> | undefined,
  firewallHeaders: Headers | null,
): Headers | Record<string, string> | undefined {
  if (!userHeaders && !firewallHeaders) return undefined;
  // Fast path: no firewall headers, pass user headers through unchanged
  if (!firewallHeaders) return userHeaders;
  const merged =
    userHeaders instanceof Headers
      ? new Headers(userHeaders)
      : new Headers(userHeaders);
  // Firewall headers override user headers (security).
  // Use set() so firewall values replace any user-supplied value for the
  // same header name (case-insensitive).
  for (const [k, v] of firewallHeaders) {
    merged.set(k, v);
  }
  return merged;
}

/**
 * Converts a Response to a FetchResult, enforcing response size limits.
 */
async function responseToResult(
  response: Response,
  url: string,
  maxResponseSize: number,
  signal?: AbortSignal,
): Promise<FetchResult> {
  // Use null-prototype to prevent prototype pollution via malicious response headers
  const headers: Record<string, string> = Object.create(null);
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Fast path: check Content-Length header
  if (maxResponseSize > 0) {
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!Number.isNaN(size) && size > maxResponseSize) {
        throw new ResponseTooLargeError(maxResponseSize);
      }
    }
  }

  // Read body as raw bytes (never UTF-8 decode — preserves JPEG, etc.)
  let body: Uint8Array;
  if (maxResponseSize > 0 && response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    try {
      while (true) {
        const { done, value } = await awaitWithSignal(reader.read(), signal);
        if (done) break;
        if (!value) continue;
        totalSize += value.byteLength;
        if (totalSize > maxResponseSize) {
          await reader.cancel();
          throw new ResponseTooLargeError(maxResponseSize);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (signal?.aborted) {
        await reader.cancel(abortReason(signal)).catch(() => undefined);
      }
      throw error;
    }
    body = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const ab = await awaitWithSignal(response.arrayBuffer(), signal);
    if (maxResponseSize > 0 && ab.byteLength > maxResponseSize) {
      throw new ResponseTooLargeError(maxResponseSize);
    }
    body = new Uint8Array(ab);
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    url,
  };
}
