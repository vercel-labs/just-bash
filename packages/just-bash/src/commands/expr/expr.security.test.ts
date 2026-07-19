import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

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
});
