import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { evaluate, parse } from "../query-engine/index.js";

/**
 * JQ Execution Limits Tests
 *
 * These tests verify that jq commands cannot cause runaway compute.
 * JQ programs should complete in bounded time regardless of input.
 *
 * IMPORTANT: All tests should complete quickly (<1s each).
 */

describe("JQ Execution Limits", () => {
  describe("string allocation protection", () => {
    it("rejects string multiplication before repeat allocates", async () => {
      const env = new Bash({
        executionLimits: { maxStringLength: 64 },
      });

      const result = await env.exec(`jq -n '"12345678" * 9'`);

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("jq: string size limit exceeded (64 bytes)\n");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("allows string multiplication at the configured boundary", async () => {
      const env = new Bash({
        executionLimits: { maxStringLength: 65 },
      });

      const result = await env.exec(`jq -nr '"12345678" * 8'`);

      expect(result.stdout).toBe(`${"12345678".repeat(8)}\n`);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("counts UTF-8 bytes for concatenation before allocation", () => {
      expect(() =>
        evaluate(null, parse(`"é" + "é"`), {
          limits: { maxStringLength: 3 },
        }),
      ).toThrowError("string size limit exceeded (3 bytes)");
    });

    it("preserves jq negative and fractional repeat semantics", async () => {
      const env = new Bash();
      const result = await env.exec(`jq -nc '["a" * -1, "a" * 1.5]'`);
      expect(result.stdout).toBe('[null,"a"]\n');
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("reserves the final output newline prospectively", async () => {
      const exact = new Bash({
        executionLimits: { maxStringLength: 100, maxOutputSize: 3 },
      });
      const accepted = await exact.exec(`jq -nr '"é"'`);
      expect(accepted.stdout).toBe("é\n");
      expect(accepted.stderr).toBe("");
      expect(accepted.exitCode).toBe(0);

      const over = new Bash({
        executionLimits: { maxStringLength: 100, maxOutputSize: 2 },
      });
      const rejected = await over.exec(`jq -nr '"é"'`);
      expect(rejected.stdout).toBe("");
      expect(rejected.stderr).toBe(
        "bash: pipeline: total output size exceeded (>2 bytes), increase executionLimits.maxOutputSize\n",
      );
      expect(rejected.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });
  });

  describe("until loop protection", () => {
    it("should protect against infinite until loop", async () => {
      const env = new Bash();
      // until condition that never becomes true
      const result = await env.exec(`echo 'null' | jq 'until(false; .)'`);

      expect(result.stderr).toContain("too many iterations");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
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

      expect(result.stderr).toContain("too many iterations");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("should allow while that terminates", async () => {
      const env = new Bash();
      const result = await env.exec(`echo '1' | jq '[while(. < 5; . + 1)]'`);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([1, 2, 3, 4]);
    });
  });

  describe("repeat protection", () => {
    it("should protect against infinite repeat", async () => {
      const env = new Bash();
      // repeat with identity produces infinite stream
      const result = await env.exec(
        `echo '1' | jq '[limit(100000; repeat(.))]'`,
      );

      expect(result.stderr).toContain("too many iterations");
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });

    it("should allow repeat that terminates naturally", async () => {
      const env = new Bash();
      // repeat with update that eventually returns empty stops
      const result = await env.exec(
        `echo '5' | jq -c '[limit(10; repeat(if . > 0 then . - 1 else empty end))]'`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("[5,4,3,2,1,0]");
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

    it("allows realistic documents deeper than the shell call-depth limit", async () => {
      const env = new Bash();
      const input = `${'{"a":'.repeat(150)}null${"}".repeat(150)}`;
      const result = await env.exec(`jq '[recurse(.a?)] | length'`, {
        stdin: input,
      });

      expect(result).toMatchObject({
        stdout: "150\n",
        stderr: "",
        exitCode: 0,
      });
    });

    it("uses the dedicated query depth limit", async () => {
      const env = new Bash({ executionLimits: { maxQueryDepth: 50 } });
      const input = `${'{"a":'.repeat(100)}null${"}".repeat(100)}`;
      const result = await env.exec(`jq '[recurse(.a?)] | length'`, {
        stdin: input,
      });

      expect(result.exitCode).toBe(126);
      expect(result.stderr).toBe("jq: query depth limit exceeded (50)\n");
    });
  });

  describe("range limits", () => {
    it("rejects oversized ranges before an outer limit can materialize them", async () => {
      const env = new Bash();
      const result = await env.exec(`jq -n '[limit(5; range(1000001))]'`);

      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("element limit exceeded");
    });

    it("should cap range output to prevent memory exhaustion", async () => {
      const env = new Bash();
      // range(2000000) exceeds the 1M default cap
      const result = await env.exec(`jq -n '[range(2000000)] | length'`);

      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("element limit exceeded");
    });

    it("should cap range with start;end form", async () => {
      const env = new Bash();
      const result = await env.exec(`jq -n '[range(0; 2000000)] | length'`);

      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("element limit exceeded");
    });

    it("should cap range with start;end;step form", async () => {
      const env = new Bash();
      const result = await env.exec(`jq -n '[range(0; 2000000; 1)] | length'`);

      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("element limit exceeded");
    });

    it("should allow moderate ranges", async () => {
      const env = new Bash();
      // 50K elements should be fine (well under 1M)
      const result = await env.exec(`jq -n '[range(50000)] | length'`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("50000");
    });
  });
});
