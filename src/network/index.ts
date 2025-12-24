/**
 * Network module
 *
 * Provides secure network access with URL allow-list enforcement.
 */

export {
  isUrlAllowed,
  matchesAllowListEntry,
  normalizeAllowListEntry,
  parseUrl,
  validateAllowList,
} from "./allow-list.js";

export {
  createSecureFetch,
  type SecureFetch,
  type SecureFetchOptions,
} from "./fetch.js";

export {
  type FetchResult,
  type HttpMethod,
  MethodNotAllowedError,
  NetworkAccessDeniedError,
  type NetworkConfig,
  RedirectNotAllowedError,
  TooManyRedirectsError,
} from "./types.js";
