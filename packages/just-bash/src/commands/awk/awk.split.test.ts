import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

async function awkBegin(program: string) {
  return new Bash().exec(`echo "" | awk '${program}'`);
}

describe("awk split()", () => {
  it.each([
    ['split("", a)', "0 0\n"],
    ['split("", a, ",")', "0 0\n"],
    ['split("", a, / /)', "0 0\n"],
    ['split("  ", a)', "0 0\n"],
    ['split("  ", a, " ")', "0 0\n"],
    ['split(" \t ", a)', "0 0\n"],
  ])("%s returns 0 and leaves the array empty", async (call, stdout) => {
    const result = await awkBegin(
      `BEGIN { n = ${call}; c = 0; for (k in a) c++; print n, c }`,
    );
    expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
  });

  it("ignores leading and trailing blanks with the default separator", async () => {
    const result = await awkBegin(
      'BEGIN { n = split("  a   b  ", a); print n "[" a[1] "][" a[2] "]" }',
    );
    expect(result).toMatchObject({
      stdout: "2[a][b]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("ignores leading and trailing blanks when the separator is a single space", async () => {
    const result = await awkBegin(
      'BEGIN { n = split(" x ", a, " "); print n "[" a[1] "]" }',
    );
    expect(result).toMatchObject({ stdout: "1[x]\n", stderr: "", exitCode: 0 });
  });

  it("empties an array that held elements from an earlier split", async () => {
    const result = await awkBegin(
      'BEGIN { split("a b c", a); n = split("", a); c = 0; for (k in a) c++; print n, c }',
    );
    expect(result).toMatchObject({ stdout: "0 0\n", stderr: "", exitCode: 0 });
  });

  it("does not loop over an empty list", async () => {
    const result = await awkBegin(
      'BEGIN { n = split("", a); for (i = 1; i <= n; i++) print "item", a[i]; print "done" }',
    );
    expect(result).toMatchObject({ stdout: "done\n", stderr: "", exitCode: 0 });
  });

  it("keeps empty fields around a non-blank separator", async () => {
    const result = await awkBegin(
      'BEGIN { n = split(",a,,b,", a, ","); print n "[" a[1] "][" a[2] "][" a[3] "][" a[4] "][" a[5] "]" }',
    );
    expect(result).toMatchObject({
      stdout: "5[][a][][b][]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("splits a lone separator into two empty fields", async () => {
    const result = await awkBegin('BEGIN { print split(",", a, ",") }');
    expect(result).toMatchObject({ stdout: "2\n", stderr: "", exitCode: 0 });
  });

  it("uses FS when no separator is given", async () => {
    const result = await new Bash().exec(
      `echo "" | awk -F, 'BEGIN { print split("a,b,", a); print split("", a) }'`,
    );
    expect(result).toMatchObject({
      stdout: "3\n0\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
