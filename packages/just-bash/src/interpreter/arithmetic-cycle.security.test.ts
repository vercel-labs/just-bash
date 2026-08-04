import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("arithmetic resolution cycles", () => {
  it.each([
    ["expression-valued scalar", "a='a + 1'; echo $((a))", "at a"],
    ["mutually recursive scalars", "a='b + 1'; b='a + 1'; echo $((a))", "at a"],
    [
      "indexed array element",
      "declare -a a; a[0]='a[0] + 1'; echo $((a[0]))",
      "at a[0]",
    ],
    [
      "associative array element",
      "declare -A a; a[x]='a[x] + 1'; echo $((a[x]))",
      "at a[x]",
    ],
  ])("terminates a %s cycle", async (_name, script, expectedPath) => {
    const bash = new Bash();

    const result = await bash.exec(script);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("arithmetic variable cycle detected");
    expect(result.stderr).toContain(expectedPath);
  });

  it("still evaluates repeated non-cyclic references", async () => {
    const bash = new Bash();
    const result = await bash.exec("a='b + 1'; b=2; echo $((a + a))");

    expect(result).toMatchObject({ stdout: "6\n", stderr: "", exitCode: 0 });
  });
});
