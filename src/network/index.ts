/**
 * Network module
 *
 * Provides secure network access with URL allow-list enforcement.
 */

export {
  createSecureFetch,
  type SecureFetch,
  type SecureFetchOptions,
} from "./fetch.js";

export {
  type AllowedUrl,
  type AllowedUrlEntry,
  type FetchResult,
  type HttpMethod,
  NetworkAccessDeniedError,
  type NetworkConfig,
  RedirectNotAllowedError,
  type RequestTransform,
  TooManyRedirectsError,
} from "./types.js";
