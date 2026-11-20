import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("${#@} and ${#*} count positional parameters", () => {
  it("counts positional parameters like $# (part of #758)", async () => {
    const bash = new Bash();
    const result = await bash.exec("set -- a b c; echo ${#@} ${#*} $#");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("3 3 3\n");
  });

  it("is 0 with no positional parameters", async () => {
    const bash = new Bash();
    const result = await bash.exec("set --; echo ${#@} ${#*} $#");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0 0 0\n");
  });

  it("still reports string length for plain variables", async () => {
    const bash = new Bash();
    const result = await bash.exec("s=hello; echo ${#s}");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("5\n");
  });

  it("still counts array elements for ${#a[@]}", async () => {
    const bash = new Bash();
    const result = await bash.exec("a=(x y z); echo ${#a[@]}");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("3\n");
  });
});
