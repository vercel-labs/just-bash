import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("expr fail-closed parsing", () => {
  it.each([
    "1 trailing",
    "1 )",
    "1 + 2 trailing",
    "1 '|' '('",
  ])("rejects unconsumed or malformed input: %s", async (expression) => {
    const result = await new Bash().exec(`expr ${expression}`);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("syntax error");
  });

  it("still parses the right side of a truthy OR for syntax", async () => {
    const result = await new Bash().exec("expr 1 '|' 2 +");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("syntax error");
  });

  it("uses bounded linear work for index membership", async () => {
    const compatible = await new Bash().exec("expr index abcdef dx");
    expect(compatible).toMatchObject({ stdout: "4\n", exitCode: 0 });

    const result = await new Bash({
      executionLimits: { maxWorkUnits: 20 },
    }).exec(`expr index '${"a".repeat(20)}' '${"z".repeat(20)}'`);

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("expr index");
  });
});
