import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { processEscapes } from "./escapes.js";

describe("printf prospective formatting limits", () => {
  const oversizedFormats = [
    "%17s",
    "%17d",
    "%17o",
    "%17x",
    "%17f",
    "%17q",
    "%17(%Y)T",
  ];

  for (const format of oversizedFormats) {
    it(`rejects ${format} before formatting allocation`, async () => {
      const bash = new Bash({ executionLimits: { maxStringLength: 16 } });
      const result = await bash.exec(`printf '${format}' 1`);

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: format width limit exceeded (16 bytes)\n",
      );
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });
  }

  it("rejects dynamic width and precision before formatting", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 16 } });

    const width = await bash.exec("printf '%*s' 17 x");
    expect(width.stdout).toBe("");
    expect(width.stderr).toBe("bash: format width limit exceeded (16 bytes)\n");
    expect(width.exitCode).toBe(ExecutionLimitError.EXIT_CODE);

    const precision = await bash.exec("printf '%.*s' 17 x");
    expect(precision.stdout).toBe("");
    expect(precision.stderr).toBe(
      "bash: format precision limit exceeded (16 bytes)\n",
    );
    expect(precision.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("allows the exact byte boundary and counts UTF-8 bytes", async () => {
    const boundary = new Bash({ executionLimits: { maxStringLength: 16 } });
    const padded = await boundary.exec("printf '%16s' x");
    expect(padded.stdout).toBe("               x");
    expect(padded.stderr).toBe("");
    expect(padded.exitCode).toBe(0);

    const unicodeBoundary = new Bash({
      executionLimits: { maxStringLength: 100, maxOutputSize: 4 },
    });
    const exact = await unicodeBoundary.exec("printf '%s' 'éé'");
    expect(exact.stdout).toBe("éé");
    expect(exact.stderr).toBe("");
    expect(exact.exitCode).toBe(0);

    const over = new Bash({
      executionLimits: { maxStringLength: 100, maxOutputSize: 3 },
    });
    const rejected = await over.exec("printf '%s' 'éé'");
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toBe(
      "bash: formatted value size limit exceeded (3 bytes)\n",
    );
    expect(rejected.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects an oversized escaped format before processing it", () => {
    expect(() => processEscapes("123456789", 8)).toThrowError(
      "escaped string size limit exceeded (8 bytes)",
    );
  });
});
