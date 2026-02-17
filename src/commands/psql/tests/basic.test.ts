/**
 * Basic psql functionality tests
 *
 * Tests require PostgreSQL running on localhost:5432
 * with user: testuser, password: testpass, database: testdb
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../../Bash.js";
import {
  getTestNetworkConfigWithCreds,
  isPostgresAvailable,
  TEST_PG_CONFIG,
} from "./test-helpers.js";

describe("psql basic operations", () => {
  let pgAvailable = false;

  beforeAll(async () => {
    pgAvailable = await isPostgresAvailable();
    if (!pgAvailable) {
      console.warn(
        "\n⚠️  PostgreSQL not available on localhost:5432 - skipping psql integration tests",
      );
      console.warn(
        "   Start PostgreSQL with: docker-compose -f docker-compose.psql-test.yml up -d\n",
      );
    }
  });

  describe("simple queries", () => {
    it("should execute SELECT query", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec('psql -h localhost -c "SELECT 1 as num"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("num");
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("(1 row)");
    });

    it("should execute version query", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec('psql -h localhost -c "SELECT version()"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("PostgreSQL");
    });

    it("should execute multiple columns", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -c "SELECT 1 as a, 2 as b, 3 as c"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("a");
      expect(result.stdout).toContain("b");
      expect(result.stdout).toContain("c");
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
      expect(result.stdout).toContain("3");
    });
  });

  describe("multiple statements", () => {
    it("should execute multiple SELECT statements", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -c "SELECT 1 as first; SELECT 2 as second"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("first");
      expect(result.stdout).toContain("second");
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
    });
  });

  describe("stdin input", () => {
    it("should read SQL from stdin", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'echo "SELECT 42 as answer" | psql -h localhost',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("42");
    });
  });

  describe("file input", () => {
    it("should execute SQL from file", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      await env.writeFile("/tmp/test.sql", "SELECT 'from file' as source");

      const result = await env.exec("psql -h localhost -f /tmp/test.sql");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("from file");
    });

    it("should error when file does not exist", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        "psql -h localhost -f /tmp/nonexistent.sql",
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("nonexistent.sql");
    });
  });

  describe("connection parameters", () => {
    it("should support port parameter", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        `psql -h localhost -p ${TEST_PG_CONFIG.port} -c "SELECT 1"`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("1");
    });

    it("should support database parameter", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        `psql -h localhost -d ${TEST_PG_CONFIG.database} -c "SELECT 1"`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("1");
    });

    it("should support username parameter with credential injection", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      // Even if we specify wrong username, credential injection should override
      const result = await env.exec(
        'psql -h localhost -U wronguser -c "SELECT 1"',
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("1");
    });
  });

  describe("credential injection (Deno Sandbox pattern)", () => {
    it("should work with user-provided credentials (string entry)", async () => {
      if (!pgAvailable) return;

      const env = new Bash({
        network: { allowedPostgresHosts: ["localhost"] },
      });

      // User must provide correct credentials
      const result = await env.exec(
        `psql -h localhost -U ${TEST_PG_CONFIG.username} -d ${TEST_PG_CONFIG.database} -c "SELECT 1"`,
      );

      // This will fail because password can't be provided via CLI (security feature)
      // But it proves the string entry allows the connection attempt
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("password authentication failed");
    });

    it("should inject credentials with object entry", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });

      // User provides wrong/no credentials, but they get injected
      const result = await env.exec('psql -h localhost -c "SELECT 1"');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("1");
    });
  });
});
