/**
 * Secure fetch adapter.
 *
 * just-bash retains path allow-listing, firewall headers, response conversion,
 * and redirect policy; guarded-fetch handles SSRF and transport safety.
 */

import type { GuardedFetchOptions } from "guarded-fetch";
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

declare const __BROWSER__: boolean | undefined;

const DEFAULT_MAX_REDIRECTS = 20;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RESPONSE_SIZE = 10485760; // 10MB
const DEFAULT_ALLOWED_METHODS: HttpMethod[] = ["GET", "HEAD"];

/** Load guarded-fetch before the defense-in-depth loader hook is active. */
type GuardedFetchModule = typeof import("guarded-fetch");

/**
 * The guarded transport, or `null` in the browser build: guarded-fetch is
 * undici-backed and Node-only, so the browser uses ambient `fetch` instead.
 */
let guardedFetchPromise: Promise<GuardedFetchModule> | null;

// Keep the browser branch statically foldable for esbuild.
if (typeof __BROWSER__ !== "undefined" && __BROWSER__) {
  guardedFetchPromise = null;
} else {
  // Load before the defense-in-depth loader hook activates.
  guardedFetchPromise = import("guarded-fetch");
  // Handled here so a failed import surfaces on the awaiting request, not as
  // a module-init unhandled rejection.
  void guardedFetchPromise.catch(() => undefined);
}

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

  // guarded-fetch resolves and pins internally with no seam for these, so
  // accepting them would silently downgrade an embedder's own policy.
  if (config._dnsResolve) {
    throw new Error(
      "NetworkConfig._dnsResolve is no longer supported: DNS resolution is " +
        "performed by guarded-fetch and cannot be overridden",
    );
  }
  if (config._createConnectionOwner) {
    throw new Error(
      "NetworkConfig._createConnectionOwner is no longer supported: " +
        "connect-time IP pinning is performed by guarded-fetch and cannot " +
        "be overridden",
    );
  }

  // Test-only transport override; see the pinned path below.
  const injectedFetch = config._fetch;

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

  // DNS resolution and connection pinning are handled by guarded-fetch.

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
        // guarded-fetch enforces SSRF checks without a host allowlist.
        return {
          allowedHosts: undefined,
          skipSsrfCheckForAllowedHosts: undefined,
        };
      }
      // Skip DNS for the explicit private-range opt-out.
      return {
        allowedHosts: [safeHostnameOf(requestUrl)],
        skipSsrfCheckForAllowedHosts: true,
      };
    }
    // Combine guarded-fetch hostname checks with path-prefix checks.
    return {
      allowedHosts,
      skipSsrfCheckForAllowedHosts: !denyPrivateRanges,
    };
  }

  /** Whether the URL's host is a private/loopback IP literal. */
  function isPrivateLiteral(requestUrl: string): boolean {
    try {
      return isPrivateIp(new URL(requestUrl).hostname);
    } catch {
      // Malformed URLs are rejected by the surrounding policy checks.
      return false;
    }
  }

  /**
   * Ambient-`fetch` transport for the audited unguarded paths, reachable only
   * while private-range enforcement is off.
   */
  async function unguardedFetch(
    requestUrl: string,
    fetchOptions: GuardedFetchOptions,
  ): Promise<Response> {
    const init: RequestInit = {
      method: fetchOptions.method,
      headers: fetchOptions.headers,
      signal: fetchOptions.signal,
      redirect: "manual",
    };
    if (fetchOptions.body !== undefined) {
      init.body = fetchOptions.body;
    }
    // @banned-pattern-ignore: audited unguarded transport, reachable only when private-range enforcement is disabled
    const ambientFetch = injectedFetch ?? globalThis.fetch;
    return await ambientFetch(requestUrl, init);
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
  function mapGuardedFetchError(
    error: unknown,
    url: string,
    mod: GuardedFetchModule,
    context: { onRedirectHop: boolean; subReason?: string },
  ): Error {
    if (!mod.isGuardedFetchError(error)) return error as Error;
    const gfError = error as {
      code: string;
      hostname?: string;
      message: string;
    };
    const { onRedirectHop, subReason } = context;
    switch (gfError.code) {
      case "host_not_allowed":
      case "protocol_not_allowed":
        // A hop rejected on its own address reads as a refused redirect.
        return onRedirectHop
          ? new RedirectNotAllowedError(url)
          : new NetworkAccessDeniedError(url);
      case "hostname_unsafe":
        // One code covers every DNS/SSRF rejection; the sub-reason separates
        // "could not resolve" from "resolved to a private address".
        return onRedirectHop
          ? new RedirectNotAllowedError(url)
          : new NetworkAccessDeniedError(
              url,
              subReason === "dns_resolution_failed"
                ? "DNS resolution failed for private IP check"
                : "hostname resolves to private/loopback IP address",
            );
      case "redirect_to_unsafe_host":
        return new RedirectNotAllowedError(url);
      case "too_many_redirects":
        return new TooManyRedirectsError(maxRedirects);
      case "response_too_large":
        return new ResponseTooLargeError(maxResponseSize);
      default:
        // Preserve the underlying timeout, network, or URL error.
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

    try {
      // Keep preflight inside finally so rejected requests clean up.
      checkPathAllowed(url);
      checkPrivateLiteral(url);
      checkMethodAllowed(method);

      // Loaded at init and cached; `null` in the browser build.
      const gfModule = guardedFetchPromise ? await guardedFetchPromise : null;

      let currentUrl = url;
      let redirectCount = 0;

      // Redirects update method, body, and user credentials per hop.
      let currentMethod = method;
      let currentBody = options.body;
      const currentHeaders = options.headers;
      let credentialsStripped = false;

      while (true) {
        throwIfAborted(combinedAbort.signal);

        // Keep transport creation inside the trusted boundary.
        const response = await DefenseInDepthBox.runTrustedAsync(async () => {
          // Strip user credentials; firewall credentials are re-applied below.
          let userHeaders = currentHeaders;
          if (credentialsStripped && userHeaders) {
            const h =
              userHeaders instanceof Headers
                ? new Headers(userHeaders)
                : new Headers(userHeaders);
            h.delete("authorization");
            h.delete("cookie");
            userHeaders = h;
          }

          const firewallHeaders = getFirewallHeaders(currentUrl);
          const mergedHeaders = buildMergedHeaders(
            userHeaders,
            firewallHeaders,
          );

          const fetchOptions: GuardedFetchOptions = {
            method: currentMethod,
            headers: mergedHeaders,
            signal: combinedAbort.signal,
            // Redirects are handled here so headers and path policy are reapplied.
            followRedirects: false,
            timeoutMs: effectiveTimeout,
            // Preserve firewall-managed Cookie/Host semantics.
            sanitizeHeaders: false,
          };

          if (currentBody && !BODYLESS_METHODS.has(currentMethod)) {
            fetchOptions.body = currentBody;
          }

          Object.assign(fetchOptions, buildHostPolicy(currentUrl));

          // No guarded transport exists for the browser build, and
          // guarded-fetch rejects private IP literals even with its host skip.
          // Both are the explicit opt-out only; enforcement on fails closed.
          if (!gfModule || isPrivateLiteral(currentUrl)) {
            if (denyPrivateRanges) {
              throw new NetworkAccessDeniedError(
                currentUrl,
                "DNS pinning unavailable for private IP enforcement",
              );
            }
            return await unguardedFetch(currentUrl, fetchOptions);
          }

          if (denyPrivateRanges) {
            // Pinning is promised here, so keep guarded-fetch's own undici
            // `fetch`: a host-wrapped `globalThis.fetch` can rebuild the init
            // and drop the `dispatcher`, reopening the rebinding window.
            if (injectedFetch) {
              fetchOptions.fetch = injectedFetch;
            }
          } else {
            // No pinning promised; ambient fetch keeps host shims working.
            // @banned-pattern-ignore: audited no-pin path, reachable only when private-range enforcement is disabled
            fetchOptions.fetch = injectedFetch ?? globalThis.fetch;
            fetchOptions.dispatcher = null;
          }

          // The block reason reaches us only through this hook.
          let blockedSubReason: string | undefined;
          fetchOptions.onUrlBlocked = (event) => {
            blockedSubReason = event.subReason;
          };

          try {
            return await gfModule.guardedFetch(currentUrl, fetchOptions);
          } catch (error) {
            throw mapGuardedFetchError(error, currentUrl, gfModule, {
              onRedirectHop: redirectCount > 0,
              subReason: blockedSubReason,
            });
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

          // Per the fetch standard and curl: 301/302 rewrite POST only, 303
          // rewrites all but GET/HEAD, 307/308 preserve method and body.
          const status = response.status;
          const rewriteToGet =
            ((status === 301 || status === 302) && currentMethod === "POST") ||
            (status === 303 &&
              currentMethod !== "GET" &&
              currentMethod !== "HEAD");
          if (rewriteToGet) {
            currentMethod = "GET";
            currentBody = undefined;
            // A rewritten method is a new request under the same policy.
            checkMethodAllowed(currentMethod);
          }

          // Do not forward user credentials across origins.
          if (new URL(redirectUrl).origin !== new URL(currentUrl).origin) {
            credentialsStripped = true;
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
