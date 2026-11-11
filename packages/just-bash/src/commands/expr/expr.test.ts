import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("expr integer operands", () => {
  it.each([
    "2.5 '*' 4",
    "4 + 2x",
    "3 - 1.2",
    "4 / 2.0",
    "4 % 2x",
    "+2 + -1",
  ])("rejects non-integers in arithmetic: %s", async (expression) => {
    const result = await new Bash().exec(`expr ${expression}`);
    expect(result).toMatchObject({
      stdout: "",
      stderr: "expr: non-integer argument\n",
      exitCode: 2,
    });
  });

  it("compares non-integer operands as strings", async () => {
    const result = await new Bash().exec("expr 2.5 = 2");
    expect(result).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 1 });
  });

  it("accepts negative integers", async () => {
    const result = await new Bash().exec("expr 2 + -1");
    expect(result).toMatchObject({ stdout: "1\n", stderr: "", exitCode: 0 });
  });
  it.each([
    "+2 = 2",
    "'1??' '<' '1?'",
  ])("compares strings by code point: %s", async (expression) => {
    const result = await new Bash().exec(`expr ${expression}`);
    expect(result).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 1 });
  });

  it.each([
    "1000000000000 '*' 1000000000 '*' 0",
    "'(' 1000000000000000000000 + 0 ')' '*' 0",
  ])("keeps large intermediate results parseable: %s", async (expression) => {
    const result = await new Bash().exec(`expr ${expression}`);
    expect(result).toMatchObject({ stdout: "0\n", stderr: "", exitCode: 1 });
  });
});
