import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * JQ Execution Limits Tests
 *
 * NOTE: We now use jq-web (real jq compiled to WebAssembly) with worker-based
 * timeout protection. Real jq does not have artificial iteration limits.
 *
 * These tests verify that:
 * 1. Infinite loops are terminated by timeout (1 second)
 * 2. Normal operations that complete quickly work correctly
 *
 * IMPORTANT: Timeout tests may take up to 1 second each.
 */

describe("JQ Execution Limits", () => {
  describe("until loop protection", () => {
    it("should protect against infinite until loop", async () => {
      const env = new Bash();
      // until condition that never becomes true
      const result = await env.exec(`echo 'null' | jq 'until(false; .)'`);

      expect(result.stderr).toContain("timeout");
      expect(result.exitCode).toBe(124); // Standard timeout exit code
    });

    it("should allow until that terminates", async () => {
      const env = new Bash();
      const result = await env.exec(`echo '0' | jq 'until(. >= 5; . + 1)'`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("5");
    });
  });

  describe("while loop protection", () => {
    it("should protect against infinite while loop", async () => {
      const env = new Bash();
      // while condition that's always true
      const result = await env.exec(`echo '0' | jq '[while(true; . + 1)]'`);

      expect(result.stderr).toContain("timeout");
      expect(result.exitCode).toBe(124);
    });

    it("should allow while that terminates", async () => {
      const env = new Bash();
      const result = await env.exec(`echo '1' | jq '[while(. < 5; . + 1)]'`);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([1, 2, 3, 4]);
    });
  });

  describe("repeat protection", () => {
    it("should protect against infinite repeat without limit", async () => {
      const env = new Bash();
      // repeat without limit produces infinite stream
      const result = await env.exec(
        `echo '1' | jq 'repeat(.)'`,
      );

      expect(result.stderr).toContain("timeout");
      expect(result.exitCode).toBe(124);
    });

    it("should allow repeat with limit", async () => {
      const env = new Bash();
      // repeat with limit terminates after specified iterations
      const result = await env.exec(
        `echo '1' | jq -c '[limit(5; repeat(.))]'`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("[1,1,1,1,1]");
    });
  });

  describe("recurse protection", () => {
    it("should handle deep recursion with limit", async () => {
      const env = new Bash();
      // recurse that doesn't naturally terminate
      const result = await env.exec(
        `echo '{"a":{"a":{"a":{"a":{}}}}}' | jq '[limit(10; recurse(.a?))]'`,
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe("range limits", () => {
    it("should handle large range with limit", async () => {
      const env = new Bash();
      const result = await env.exec(`jq -n '[limit(5; range(1000000))]'`);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
