/**
 * Connection string parsing and option resolution for psql
 */

import type { SecurePostgresOptions } from "../../network/index.js";
import type { PsqlOptions } from "./parser.js";

/**
 * Build SecurePostgresOptions from parsed CLI options
 */
export function buildConnectionOptions(
  options: PsqlOptions,
): SecurePostgresOptions | null {
  // Host is required
  if (!options.host) {
    return null;
  }

  return {
    host: options.host,
    port: options.port,
    database: options.database,
    username: options.username,
    password: undefined, // Password via CLI is not supported for security
    ssl: "prefer", // Default to prefer SSL
  };
}

/**
 * Get SQL to execute from options
 * Returns empty string only if no SQL source is available (no -c, no -f, no stdin)
 */
export function getSqlToExecute(options: PsqlOptions, stdin: string): string {
  // -c takes precedence
  if (options.command) {
    return options.command;
  }

  // -f will be read later, return placeholder
  if (options.file) {
    return "FILE"; // Non-empty placeholder to pass validation
  }

  // Check stdin
  if (stdin.trim()) {
    return stdin.trim();
  }

  return "";
}
