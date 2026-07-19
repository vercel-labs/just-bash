import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("column allocation limits", () => {
  it("rejects excess fields before collecting them", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 3 } });
    const result = await bash.exec("column -t -s ,", { stdin: "a,b,c,d" });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: column: field limit exceeded (3)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("checks padded table output prospectively", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 8 } });
    const result = await bash.exec("column -t -s ,", {
      stdin: "a,bbbb\ncc,d",
    });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: column: output size limit exceeded (8 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects non-finite widths before fill calculations", async () => {
    const bash = new Bash();
    const result = await bash.exec("column -c Infinity", { stdin: "a" });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("column: invalid width: NaN\n");
    expect(result.exitCode).toBe(1);
  });

  it("bounds command-local input before splitting", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 16 } });
    const result = await bash.exec("column", { stdin: "a".repeat(17) });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: stdin size limit exceeded (16 bytes)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });
});
