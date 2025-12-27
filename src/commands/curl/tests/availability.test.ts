/**
 * Tests for curl command availability
 *
 * curl is only available when network is explicitly configured.
 */

import { describe, expect, it } from "vitest";
import { Bash } from "../../../Bash.js";

describe("curl availability", () => {
  describe("without network configuration", () => {
    it("curl command does not exist", async () => {
      const env = new Bash();
      const result = await env.exec("curl https://example.com");
      expect(result.exitCode).toBe(127); // Command not found
      expect(result.stderr).toContain("command not found");
    });

    it("curl is not in /bin", async () => {
      const env = new Bash();
      const result = await env.exec("ls /bin/curl");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No such file");
    });

    it("curl does not appear in ls /bin output", async () => {
      const env = new Bash();
      const result = await env.exec("ls /bin | grep ^curl$");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(1); // grep returns 1 when no match
    });

    it("curl is not listed among available commands", async () => {
      const env = new Bash();
      const result = await env.exec("ls /bin");
      expect(result.stdout).not.toContain("curl");
    });
  });

  describe("with network configuration", () => {
    it("curl command exists", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://example.com"] },
      });
      const result = await env.exec("curl --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("curl");
    });

    it("curl is in /bin when default layout", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://example.com"] },
      });
      const result = await env.exec("ls /bin/curl");
      expect(result.exitCode).toBe(0);
    });

    it("curl --help shows usage", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://example.com"] },
      });
      const result = await env.exec("curl --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("transfer a URL");
      expect(result.stdout).toContain("-X");
      expect(result.stdout).toContain("--header");
    });
  });

  describe("Sandbox API", () => {
    it("supports network config via Sandbox.create", async () => {
      const { Sandbox } = await import("../../../sandbox/index.js");
      const sandbox = await Sandbox.create({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const cmd = await sandbox.runCommand("curl --help");
      const stdout = await cmd.stdout();
      expect(stdout).toContain("curl");
    });
  });
});
