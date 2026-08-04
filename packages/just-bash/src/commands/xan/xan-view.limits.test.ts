import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("xan view output limits", () => {
  it("rejects padded table amplification during rendering", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 128 } });
    const result = await bash.exec("xan view", {
      stdin: `value\n${"x".repeat(64)}\na\nb\nc\n`,
    });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: xan: output size limit exceeded (128 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("preserves exact ordinary table rendering", async () => {
    const bash = new Bash();
    const result = await bash.exec("xan view", {
      stdin: "a,b\n1,2\n",
    });
    expect(result.stdout).toBe(
      "┌───┬───┐\n│ a │ b │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
