import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("expr | chains", () => {
  it.each([
    ["5 '|' 6 '|' 7", "5\n"],
    ["0 '|' 0 '|' 7", "7\n"],
    ["0 '|' 5 '|' 7", "5\n"],
    ["0 '|' 5", "5\n"],
    ["5 '|' 6", "5\n"],
    ["'' '|' '' '|' x", "x\n"],
  ])("expr %s prints the first non-null, non-zero operand", async (expression, stdout) => {
    const result = await new Bash().exec(`expr ${expression}`);
    expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
  });

  it("returns the first match of a chain of regex matches", async () => {
    const result = await new Bash().exec(
      "expr abc : 'a.*' '|' abc : 'ab.*' '|' abc : 'x.*'",
    );
    expect(result).toMatchObject({ stdout: "3\n", stderr: "", exitCode: 0 });
  });

  it("exits 1 when a chain ends in a null or zero result", async () => {
    const result = await new Bash().exec("expr 0 '|' 0 '|' 0");
    expect(result.exitCode).toBe(1);
  });

  it("combines & and | with & binding tighter", async () => {
    const first = await new Bash().exec("expr 0 '|' 3 '&' 4 '|' 9");
    expect(first).toMatchObject({ stdout: "3\n", stderr: "", exitCode: 0 });
    const second = await new Bash().exec("expr 0 '|' 0 '&' 4 '|' 9");
    expect(second).toMatchObject({ stdout: "9\n", stderr: "", exitCode: 0 });
  });
});
