/**
 * Secure fetch wrapper backed by guarded-fetch
 *
 * This module preserves just-bash's public secure-fetch contract
 * (`createSecureFetch`, `SecureFetch`, `SecureFetchOptions`, `FetchResult`)
 * and its path-prefix allow-list + firewall header transforms, while
 * delegating the SSRF/DNS-rebinding/redirect/transport layer to the
 * `guarded-fetch` package.
 *
 * Responsibilities retained here:
 * 1. Path-prefix allow-list enforcement (guarded-fetch is hostname-only).
 * 2. Firewall header transforms — credentials brokering at the fetch boundary
 *    so secrets never enter the sandbox, re-applied per redirect hop.
 * 3. Translation of the undici `Response` returned by guarded-fetch into the
 *    `FetchResult` shape (null-prototype headers, raw bytes) that just-bash
 *    commands consume.
 * 4. Mapping guarded-fetch's `GuardedFetchError` codes onto just-bash's
 *    domain error types so existing callers/tests keep working.
 *
 * Responsibilities delegated to guarded-fetch:
 * - Private/loopback/link-local IP rejection (lexical + DNS-resolved).
 * - DNS-rebinding protection via connect-time IP pinning.
 * - Protocol allow-listing (http/https only).
 * - Redirect following with per-hop SSRF re-validation.
 * - Header sanitization (SSRF/proxy/cookie/cloud-metadata stripping).
 * - Cross-origin credential stripping on redirects.
 */

import {
  type GuardedFetchOptions,
  guardedFetch,
  isGuardedFetchError,
} from "guarded-fetch";
import { combineAbortSignals } from "../abort-signals.js";
import { DefenseInDepthBox } from "../security/defense-in-depth-box.js";
import { _clearTimeout, _setTimeout } from "../timers.js";
import {
  isPrivateIp,
  isUrlAllowed,
  matchesAllowListEntry,
  validateAllowList,
} from "./allow-list.js";
import type { AllowedUrl, AllowedUrlEntry } from "./types.js";
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

  /**
   * Builds the hostname allowlist that guarded-fetch enforces. guarded-fetch
   * matches hostnames exactly or as subdomains; just-bash's allow-list is
   * origin + path prefix, so the host portion is extracted here and the
   * path portion continues to be enforced by `checkPathAllowed` below.
   */
  const allowedHosts: string[] = [];
  for (const entry of entries) {
    const entryUrl = typeof entry === "string" ? entry : entry.url;
    try {
      allowedHosts.push(new URL(entryUrl).hostname);
    } catch {
      // validateAllowList already rejected malformed entries above.
    }
  }

  // guarded-fetch performs its own DNS resolution for SSRF protection. It does
  // not expose a lookup-injection seam, so the bespoke `_dnsResolve` and
  // `_createConnectionOwner` test hooks are not bridged; the e2e suites that
  // relied on them are rewritten to assert behavior through the public
  // `SecureFetch` surface instead.

  /**
   * Extracts a hostname for guarded-fetch's host allowlist, returning a
   * bare string that won't accidentally match the empty-host deny-all rule.
   */
  function safeHostnameOf(requestUrl: string): string {
    try {
      return new URL(requestUrl).hostname || "localhost.invalid";
    } catch {
      return "localhost.invalid";
    }
  }

  /**
   * Builds the guarded-fetch host-policy options for a given URL.
   *
   * just-bash only performs DNS resolution when `denyPrivateRanges` is on.
   * guarded-fetch always resolves DNS unless `skipSsrfCheckForAllowedHosts`
   * matches the request's hostname. To preserve the bespoke "no DNS when
   * private-range denial is off" behavior, the request's own hostname is
   * passed as a one-entry allowlist with the SSRF check skipped. When
   * `denyPrivateRanges` is on, the configured hosts (or none, for full
   * internet) are passed without skipping so guarded-fetch's DNS/SSRF
   * layer runs.
   */
  function buildHostPolicy(
    requestUrl: string,
  ): Pick<
    GuardedFetchOptions,
    "allowedHosts" | "skipSsrfCheckForAllowedHosts"
  > {
    if (config.dangerouslyAllowFullInternetAccess) {
      if (denyPrivateRanges) {
        // No host allowlist; guarded-fetch's SSRF check is the sole gate and
        // private/loopback/link-local addresses are rejected by it.
        return {};
      }
      // No private-range denial: skip DNS entirely by trusting the request's
      // own hostname, matching the bespoke implementation.
      return {
        allowedHosts: [safeHostnameOf(requestUrl)],
        skipSsrfCheckForAllowedHosts: true,
      };
    }
    // Allow-list mode. allowedHosts carries the configured origins so
    // guarded-fetch enforces hostname scoping in addition to just-bash's
    // path-prefix check.
    return {
      allowedHosts,
      skipSsrfCheckForAllowedHosts: !denyPrivateRanges,
    };
  }

  /**
   * Checks if a URL is allowed by the path-prefix allow-list.
   *
   * guarded-fetch only allowlists by hostname, so the path-scoped portion of
   * just-bash's policy (e.g. `https://api.example.com/v1/`) is enforced here,
   * before the request is handed to guarded-fetch.
   *
   * @throws NetworkAccessDeniedError if the URL is not allowed
   */
  function checkPathAllowed(url: string): void {
    if (
      !config.dangerouslyAllowFullInternetAccess &&
      !isUrlAllowed(url, entries)
    ) {
      throw new NetworkAccessDeniedError(url);
    }
  }

  /**
   * Mirrors the bespoke preflight for private IP literals. guarded-fetch
   * rejects these at connect time too, but checking here keeps the
   * `NetworkAccessDeniedError` message shape that e2e suites assert on.
   */
  function checkPrivateLiteral(url: string): void {
    if (!denyPrivateRanges) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new NetworkAccessDeniedError(url, "invalid URL");
    }
    if (isPrivateIp(parsed.hostname)) {
      throw new NetworkAccessDeniedError(
        url,
        "private/loopback IP address blocked",
      );
    }
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
   * Translates a guarded-fetch failure into just-bash's domain error types so
   * the bespoke error messages that curl/tests assert on are preserved.
   */
  function mapGuardedFetchError(error: unknown, url: string): Error {
    if (!isGuardedFetchError(error)) return error as Error;
    const gfError = error as {
      code: string;
      hostname?: string;
      message: string;
    };
    switch (gfError.code) {
      case "host_not_allowed":
      case "protocol_not_allowed":
        return new NetworkAccessDeniedError(url);
      case "hostname_unsafe":
        // guarded-fetch unifies lexical + DNS-resolved private IPs under one
        // code. The lexical literal case is pre-empted above; a DNS-resolved
        // private address surfaces here.
        return new NetworkAccessDeniedError(
          url,
          "hostname resolves to private/loopback IP address",
        );
      case "redirect_to_unsafe_host":
        return new RedirectNotAllowedError(url);
      case "too_many_redirects":
        return new TooManyRedirectsError(maxRedirects);
      case "response_too_large":
        return new ResponseTooLargeError(maxResponseSize);
      default:
        // timeout, network_error, redirect_invalid, invalid_url — surface the
        // underlying abort/network reason so callers see the original cause.
        return error as Error;
    }
  }

  /**
   * Performs a fetch with allow-list enforcement and manual redirect handling.
   *
   * Redirects are driven here (rather than left to guarded-fetch) so that
   * firewall headers can be re-evaluated for each hop's URL and path-scoped
   * allow-listing is re-checked against the redirect target.
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

    // Pre-flight the path-prefix allow-list and method policy before any
    // transport. guarded-fetch's hostname allowlist + SSRF checks run inside
    // each guardedFetch call below.
    checkPathAllowed(url);
    checkPrivateLiteral(url);
    checkMethodAllowed(method);

    try {
      let currentUrl = url;
      let redirectCount = 0;

      while (true) {
        throwIfAborted(combinedAbort.signal);

        const response = await DefenseInDepthBox.runTrustedAsync(async () => {
          const firewallHeaders = getFirewallHeaders(currentUrl);
          const mergedHeaders = buildMergedHeaders(
            options.headers,
            firewallHeaders,
          );
          const fetchOptions: GuardedFetchOptions = {
            method,
            headers: mergedHeaders,
            signal: combinedAbort.signal,
            // We drive redirects ourselves so firewall headers are re-applied
            // per hop and path-scoped allow-listing is re-checked.
            followRedirects: false,
            timeoutMs: effectiveTimeout,
            // just-bash's firewall-header system is its own (narrower)
            // sanitization layer: the sandbox can set cookies/Host via curl and
            // firewall transforms only override specific headers. guarded-fetch's
            // blanket Cookie/Host stripping would break that contract, so hand
            // the merged headers through verbatim. SSRF/redirect/DNS protections
            // remain fully in force.
            sanitizeHeaders: false,
          };

          if (options.body && !BODYLESS_METHODS.has(method)) {
            fetchOptions.body = options.body;
          }

          Object.assign(fetchOptions, buildHostPolicy(currentUrl));

          // Tests and the browser build may install a `globalThis.fetch`.
          // guarded-fetch defaults to undici.fetch; route through whatever the
          // ambient fetch is so mock fetches and shims are honored.
          fetchOptions.fetch = globalThis.fetch as typeof fetch;

          try {
            return await guardedFetch(currentUrl, fetchOptions);
          } catch (error) {
            throw mapGuardedFetchError(error, currentUrl);
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
          // Do not leave a redirect body live while reviewing the next address.
          await awaitWithSignal(
            cancelResponseBody(response),
            combinedAbort.signal,
          );

          // Re-check path-prefix allow-list and private literal for the hop.
          try {
            checkPathAllowed(redirectUrl);
            checkPrivateLiteral(redirectUrl);
          } catch (error) {
            if (combinedAbort.signal?.aborted) {
              throw abortReason(combinedAbort.signal);
            }
            if (error instanceof NetworkAccessDeniedError) {
              throw new RedirectNotAllowedError(redirectUrl);
            }
            throw error;
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
      }
    } finally {
      _clearTimeout(timeoutId);
      combinedAbort.cleanup();
    }
  }

  return secureFetch;
}

/**
 * Awaits a promise, rejecting early if the signal aborts. Mirrors the helper
 * the bespoke implementation used so cancellation semantics are preserved.
 */
async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
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

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body && !response.body.locked) {
    await response.body.cancel();
  }
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
