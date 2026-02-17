/**
 * Test helpers for psql tests
 */

import type { NetworkConfig } from "../../../network/index.js";

/**
 * PostgreSQL connection info for tests
 * Expects PostgreSQL running on localhost:5432 with testuser/testpass/testdb
 */
export const TEST_PG_CONFIG = {
  host: "localhost",
  port: 5432,
  database: "testdb",
  username: "testuser",
  password: "testpass",
};

/**
 * Check if PostgreSQL is available for testing
 */
export async function isPostgresAvailable(): Promise<boolean> {
  try {
    const postgres = await import("postgres");
    const sql = postgres.default({
      ...TEST_PG_CONFIG,
      max: 1,
      connect_timeout: 2,
    });

    await sql`SELECT 1`;
    await sql.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Network config for tests - allows localhost connections
 */
export function getTestNetworkConfig(): NetworkConfig {
  return {
    allowedPostgresHosts: ["localhost"],
  };
}

/**
 * Network config for tests with credential injection
 */
export function getTestNetworkConfigWithCreds(): NetworkConfig {
  return {
    allowedPostgresHosts: [
      {
        host: "localhost",
        port: 5432,
        database: "testdb",
        username: "testuser",
        password: "testpass",
      },
    ],
  };
}

/**
 * Skip test if PostgreSQL is not available
 */
export function skipIfNoPostgres(
  testFn: () => void | Promise<void>,
): () => void | Promise<void> {
  return async () => {
    const available = await isPostgresAvailable();
    if (!available) {
      console.warn(
        "⚠️  Skipping psql test: PostgreSQL not available on localhost:5432",
      );
      return;
    }
    return testFn();
  };
}
