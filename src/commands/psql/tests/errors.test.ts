/**
 * Tests for psql error handling
 *
 * Tests require PostgreSQL running on localhost:5432
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../../Bash.js";
import {
  getTestNetworkConfigWithCreds,
  isPostgresAvailable,
} from "./test-helpers.js";

describe("psql error handling", () => {
  let pgAvailable = false;

  beforeAll(async () => {
    pgAvailable = await isPostgresAvailable();
    if (!pgAvailable) {
      console.warn(
        "\n⚠️  PostgreSQL not available - skipping psql error tests\n",
      );
    }
  });

  describe("SQL errors", () => {
    it("should handle syntax errors", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -c "SELEC 1"', // Missing T in SELECT
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("ERROR");
    });

    it("should handle missing table errors", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -c "SELECT * FROM nonexistent_table_xyz"',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("ERROR");
      expect(result.stderr).toContain("does not exist");
    });
  });

  describe("connection errors", () => {
    it("should error when connecting to non-allowed host", async () => {
      if (!pgAvailable) return;

      const env = new Bash({
        network: {
          allowedPostgresHosts: ["not-localhost"],
        },
      });

      const result = await env.exec('psql -h localhost -c "SELECT 1"');

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("PostgreSQL access denied");
      expect(result.stderr).toContain("Host not in allow-list");
    });

    it("should error with invalid credentials (string entry)", async () => {
      if (!pgAvailable) return;

      const env = new Bash({
        network: {
          allowedPostgresHosts: ["localhost"],
        },
      });

      // String entry allows connection but no password provided
      const result = await env.exec(
        'psql -h localhost -U wronguser -d testdb -c "SELECT 1"',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("password authentication failed");
    });
  });

  describe("statement execution errors", () => {
    it("should stop on first error in multi-statement query", async () => {
      if (!pgAvailable) return;

      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -c "SELECT 1; SELEC 2; SELECT 3"',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("1"); // First query executed
      expect(result.stdout).not.toContain("3"); // Third query not reached
      expect(result.stderr).toContain("ERROR");
    });
  });

  describe("command-line errors", () => {
    it("should error on invalid port number", async () => {
      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -p invalid -c "SELECT 1"',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid port");
    });

    it("should error on port out of range", async () => {
      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost -p 999999 -c "SELECT 1"',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid port");
    });

    it("should error on unknown option", async () => {
      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec(
        'psql -h localhost --unknown-option -c "SELECT 1"',
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid option");
    });

    it("should error when option missing argument", async () => {
      const env = new Bash({ network: getTestNetworkConfigWithCreds() });
      const result = await env.exec("psql -h localhost -c");

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("requires an argument");
    });
  });
});
