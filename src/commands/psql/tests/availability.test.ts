/**
 * Tests for psql command availability
 *
 * psql is only available when PostgreSQL network access is configured.
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../../Bash.js";

describe("psql availability", () => {
  describe("without network configuration", () => {
    it("psql command does not exist", async () => {
      const env = new Bash();
      const result = await env.exec('psql -h localhost -c "SELECT 1"');
      expect(result.exitCode).toBe(127); // Command not found
      expect(result.stderr).toContain("command not found");
    });

    it("psql is not in /bin", async () => {
      const env = new Bash();
      const result = await env.exec("ls /bin/psql");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No such file");
    });

    it("psql does not appear in ls /bin output", async () => {
      const env = new Bash();
      const result = await env.exec("ls /bin | grep ^psql$");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(1); // grep returns 1 when no match
    });
  });

  describe("with network configuration", () => {
    it("psql command exists with allowedPostgresHosts", async () => {
      const env = new Bash({
        network: { allowedPostgresHosts: ["localhost"] },
      });
      const result = await env.exec("psql --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("psql");
    });

    it("psql is in /bin when network configured", async () => {
      const env = new Bash({
        network: { allowedPostgresHosts: ["localhost"] },
      });
      const result = await env.exec("ls /bin/psql");
      expect(result.exitCode).toBe(0);
    });

    it("psql --help shows usage", async () => {
      const env = new Bash({
        network: { allowedPostgresHosts: ["localhost"] },
      });
      const result = await env.exec("psql --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("PostgreSQL interactive terminal");
      expect(result.stdout).toContain("-h, --host");
      expect(result.stdout).toContain("-c, --command");
      expect(result.stdout).toContain("--json");
    });

    it("psql command exists with dangerouslyAllowFullInternetAccess", async () => {
      const env = new Bash({
        network: { dangerouslyAllowFullInternetAccess: true },
      });
      const result = await env.exec("psql --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("psql");
    });
  });

  describe("error messages", () => {
    it("shows helpful error when host not specified", async () => {
      const env = new Bash({
        network: { allowedPostgresHosts: ["localhost"] },
      });
      const result = await env.exec('psql -c "SELECT 1"');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no host specified");
      expect(result.stderr).toContain("-h/--host required");
    });

    it("shows helpful error when no SQL provided", async () => {
      const env = new Bash({
        network: { allowedPostgresHosts: ["localhost"] },
      });
      const result = await env.exec("psql -h localhost");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("no SQL provided");
      expect(result.stderr).toContain("use -c, -f, or stdin");
    });
  });
});
