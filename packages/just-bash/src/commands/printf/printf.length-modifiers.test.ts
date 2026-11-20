import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const run = async (script: string) => {
  const env = new Bash();
  return env.exec(script);
};

describe("printf length modifiers", () => {
  it("accepts l with the integer conversions", async () => {
    const result = await run(
      "printf '[%ld] [%5ld] [%-5ld] [%05ld] [%+ld]\\n' 1 2 3 4 5",
    );
    expect(result.stdout).toBe("[1] [    2] [3    ] [00004] [+5]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("accepts ll with the integer conversions", async () => {
    const result = await run(
      "printf '[%lu] [%lx] [%lX] [%lo] [%lli] [%lld] [%llu] [%llx]\\n' 3 255 255 8 -9 1 2 255",
    );
    expect(result.stdout).toBe("[3] [ff] [FF] [10] [-9] [1] [2] [ff]\n");
    expect(result.stderr).toBe("");
  });

  it("accepts h, hh, j, z and t", async () => {
    const result = await run(
      "printf '[%hd] [%hhd] [%hu] [%hhx] [%jd] [%ju] [%zd] [%zu] [%td]\\n' 4 5 6 255 7 8 9 10 11",
    );
    expect(result.stdout).toBe("[4] [5] [6] [ff] [7] [8] [9] [10] [11]\n");
    expect(result.stderr).toBe("");
  });

  it("accepts l and L with the floating point conversions", async () => {
    const result = await run(
      "printf '[%lf] [%Lf] [%.2lf] [%le] [%lg] [%Lg] [%LE] [%lG]\\n' 2.5 1.5 3.14159 4.5 3.5 7.5 100 100",
    );
    expect(result.stdout).toBe(
      "[2.500000] [1.500000] [3.14] [4.500000e+00] [3.5] [7.5] [1.000000E+02] [100]\n",
    );
    expect(result.stderr).toBe("");
  });

  it("accepts l with %s and %c", async () => {
    const result = await run("printf '[%ls] [%lc] [%10ls]\\n' str xyz abc");
    expect(result.stdout).toBe("[str] [x] [       abc]\n");
    expect(result.stderr).toBe("");
  });

  it("accepts the modifiers with %s and %c, as bash does", async () => {
    const result = await run(
      "printf '[%hs] [%hhs] [%Ls] [%js] [%zs] [%lc] [%hc]\\n' a b c d e f g",
    );
    expect(result.stdout).toBe("[a] [b] [c] [d] [e] [f] [g]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("rejects a modifier in front of %%, as bash does", async () => {
    for (const format of ["%l%", "%h%", "%ll%"]) {
      const result = await run(`printf '${format}' 7`);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toBe("");
      expect(result.exitCode).toBe(1);
    }
  });

  it("takes a width and precision from the arguments before the modifier", async () => {
    const result = await run("printf '[%*ld] [%.*lf]\\n' 4 7 2 3.14159");
    expect(result.stdout).toBe("[   7] [3.14]\n");
    expect(result.stderr).toBe("");
  });
});
