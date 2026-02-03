/**
 * Secure fetch wrapper with allow-list enforcement
 *
 * This module provides a fetch wrapper that:
 * 1. Enforces URL allow-list at the fetch layer (not subject to parsing)
 * 2. Handles redirects manually to check each redirect target against the allow-list
 * 3. Provides timeout support
 */

import { isUrlAllowed } from "./allow-list.js";
import {
  type FetchResult,
  type HttpMethod,
  MethodNotAllowedError,
  NetworkAccessDeniedError,
  type NetworkConfig,
  RedirectNotAllowedError,
  TooManyRedirectsError,
} from "./types.js";

const DEFAULT_MAX_REDIRECTS = 20;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_ALLOWED_METHODS: HttpMethod[] = ["GET", "HEAD"];

/**
 * HTTP methods that should not have a body
 */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Redirect status codes
 */
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export interface SecureFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  /** Override timeout for this request (capped at global timeout) */
  timeoutMs?: number;
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
  const maxRedirects = config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowedMethods = config.dangerouslyAllowFullInternetAccess
    ? ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
    : (config.allowedMethods ?? DEFAULT_ALLOWED_METHODS);

  /**
   * Checks if a URL is allowed by the configuration.
   * @throws NetworkAccessDeniedError if the URL is not allowed
   */
  function checkAllowed(url: string): void {
    if (config.dangerouslyAllowFullInternetAccess) {
      return;
    }

    if (!isUrlAllowed(url, config.allowedUrlPrefixes ?? [])) {
      throw new NetworkAccessDeniedError(url);
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
   * Performs a fetch with allow-list enforcement and manual redirect handling.
   */
  async function secureFetch(
    url: string,
    options: SecureFetchOptions = {},
  ): Promise<FetchResult> {
    const method = options.method?.toUpperCase() ?? "GET";

    // Check if URL and method are allowed
    checkAllowed(url);
    checkMethodAllowed(method);

    let currentUrl = url;
    let redirectCount = 0;
    const followRedirects = options.followRedirects ?? true;

    // Use per-request timeout if specified, but cap at global timeout
    const effectiveTimeout =
      options.timeoutMs !== undefined
        ? Math.min(options.timeoutMs, timeoutMs)
        : timeoutMs;

    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

      try {
        const fetchOptions: RequestInit = {
          method,
          headers: options.headers,
          signal: controller.signal,
          redirect: "manual", // Handle redirects manually to check allow-list
        };

        // Only include body for methods that support it
        if (options.body && !BODYLESS_METHODS.has(method)) {
          fetchOptions.body = options.body;
        }

        const response = await fetch(currentUrl, fetchOptions);

        // Check for redirects
        if (REDIRECT_CODES.has(response.status) && followRedirects) {
          const location = response.headers.get("location");
          if (!location) {
            // No location header, return the response as-is
            return await responseToResult(response, currentUrl);
          }

          // Resolve relative URLs
          const redirectUrl = new URL(location, currentUrl).href;

          // Check if redirect target is allowed
          if (!config.dangerouslyAllowFullInternetAccess) {
            if (!isUrlAllowed(redirectUrl, config.allowedUrlPrefixes ?? [])) {
              throw new RedirectNotAllowedError(redirectUrl);
            }
          }

          redirectCount++;
          if (redirectCount > maxRedirects) {
            throw new TooManyRedirectsError(maxRedirects);
          }

          currentUrl = redirectUrl;
          continue;
        }

        return await responseToResult(response, currentUrl);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  return secureFetch;
}

/**
 * Converts a Response to a FetchResult.
 */
async function responseToResult(
  response: Response,
  url: string,
): Promise<FetchResult> {
  // Use null-prototype to prevent prototype pollution via malicious response headers
  const headers: Record<string, string> = Object.create(null);
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: await response.text(),
    url,
  };
}
