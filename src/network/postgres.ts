/**
 * Secure PostgreSQL connection module with Deno Sandbox-style secrets management
 *
 * This module provides:
 * 1. Host allow-list enforcement
 * 2. Transparent credential injection (user code never sees production passwords)
 * 3. Connection timeout and resource limits
 */

import postgres from "postgres";
import type { NetworkConfig } from "./types.js";
import { PostgresAccessDeniedError } from "./types.js";

/**
 * Options for establishing a PostgreSQL connection
 */
export interface SecurePostgresOptions {
  host: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean | "prefer" | "require" | "disable";
}

/**
 * Type for the secure PostgreSQL connection function
 */
export type SecurePostgresConnect = (
  options: SecurePostgresOptions,
) => Promise<postgres.Sql>;

/**
 * Creates a secure PostgreSQL connection factory that enforces the allow-list
 * and injects credentials transparently.
 */
export function createSecurePostgresConnect(
  config: NetworkConfig,
): SecurePostgresConnect {
  return async (userOptions: SecurePostgresOptions): Promise<postgres.Sql> => {
    // Resolve connection options (checks allow-list and injects credentials)
    const finalOptions = resolvePostgresConnection(userOptions, config);

    if (!finalOptions) {
      throw new PostgresAccessDeniedError(userOptions.host);
    }

    // Create connection with final options
    // Single connection, short idle timeout for resource protection
    const sql = postgres({
      host: finalOptions.host,
      port: finalOptions.port ?? 5432,
      database: finalOptions.database,
      username: finalOptions.username,
      password: finalOptions.password,
      ssl: resolveSslOption(finalOptions.ssl),
      max: 1, // Single connection to prevent resource exhaustion
      idle_timeout: 10, // Disconnect after 10s of inactivity
      connect_timeout: 10, // Connection timeout in seconds
      onnotice: () => {}, // Suppress NOTICE messages
    });

    return sql;
  };
}

/**
 * Resolves PostgreSQL connection options based on allow-list and credential injection.
 *
 * Logic:
 * 1. If dangerouslyAllowFullInternetAccess: allow any connection
 * 2. If host matches string entry: allow with user-provided credentials
 * 3. If host matches object entry: inject configured credentials (override user values)
 * 4. Otherwise: deny connection
 */
function resolvePostgresConnection(
  userOptions: SecurePostgresOptions,
  config: NetworkConfig,
): SecurePostgresOptions | null {
  // If dangerouslyAllowFullInternetAccess, allow anything
  if (config.dangerouslyAllowFullInternetAccess) {
    return userOptions;
  }

  const allowedHosts = config.allowedPostgresHosts ?? [];

  for (const entry of allowedHosts) {
    if (typeof entry === "string") {
      // String entry: allow connection with user-provided credentials
      if (entry === userOptions.host) {
        return userOptions;
      }
    } else {
      // Object entry: inject credentials (Deno Sandbox pattern)
      if (entry.host === userOptions.host) {
        return {
          host: entry.host,
          port: entry.port ?? userOptions.port,
          database: entry.database ?? userOptions.database,
          // Override username and password with configured values
          username: entry.username ?? userOptions.username,
          password: entry.password ?? userOptions.password,
          ssl: entry.ssl ?? userOptions.ssl,
        };
      }
    }
  }

  // Host not in allow-list
  return null;
}

/**
 * Converts SSL option to postgres.js format
 */
function resolveSslOption(
  ssl: boolean | "prefer" | "require" | "disable" | undefined,
): boolean | "require" | "prefer" {
  if (ssl === undefined || ssl === "prefer") return "prefer";
  if (ssl === "require") return "require";
  if (ssl === "disable" || ssl === false) return false;
  return true;
}
