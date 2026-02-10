/**
 * Network module
 *
 * Provides secure network access with URL allow-list enforcement and
 * PostgreSQL connections with Deno Sandbox-style secrets management.
 */

export {
  createSecureFetch,
  type SecureFetch,
  type SecureFetchOptions,
} from "./fetch.js";

export {
  createSecurePostgresConnect,
  type SecurePostgresConnect,
  type SecurePostgresOptions,
} from "./postgres.js";

export {
  type FetchResult,
  type HttpMethod,
  NetworkAccessDeniedError,
  type NetworkConfig,
  type PostgresHostConfig,
  RedirectNotAllowedError,
  TooManyRedirectsError,
} from "./types.js";
