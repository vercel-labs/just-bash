import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec CPU timeout", () => {
  it(
    "runs a CPU-bound script up to maxJsTimeoutMs, not a fixed CPU budget",
    { timeout: 180000 },
    async () => {
      const bash = new Bash({
        javascript: true,
        executionLimits: { maxJsTimeoutMs: 120_000 },
      });
      const result = await bash.exec(
        `js-exec -c 'let s = 0; for (let i = 0; i < 1e8; i++) s += i; console.log(s)'`,
      );
      expect(result.stdout).toBe("4999999950000000\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    },
  );

  it(
    "reports a CPU-bound script that exceeds maxJsTimeoutMs as exit 124",
    { timeout: 30000 },
    async () => {
      const bash = new Bash({
        javascript: true,
        executionLimits: { maxJsTimeoutMs: 500 },
      });
      const result = await bash.exec(`js-exec -c 'while (true) {}'`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "js-exec: Execution timeout: exceeded 500ms limit\n",
      );
      expect(result.exitCode).toBe(124);
    },
  );
});
