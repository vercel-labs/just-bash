import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tr escape sequences", () => {
  const run = (script: string) =>
    new Bash({ files: {}, cwd: "/" }).exec(script);

  it("decodes a three-digit octal escape", async () => {
    const result = await run("echo X | tr X '\\015'");
    expect(result.stdout).toBe("\r\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("decodes an octal escape for a printable character", async () => {
    const result = await run("echo abc | tr b '\\101'");
    expect(result.stdout).toBe("aAc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("decodes one- and two-digit octal escapes", async () => {
    const result = await run("printf 'abc\\n' | tr 'ab' '\\1\\60'");
    expect(result.stdout).toBe("\x010c\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("stops an octal escape at the first non-octal digit", async () => {
    const result = await run("printf 'a8b\\n' | tr '8' '\\18'");
    expect(result.stdout).toBe("a\x01b\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reads at most three octal digits", async () => {
    // \0101 is \010 (backspace) followed by 1, not \101 (A).
    const result = await run("printf 'ab\\n' | tr 'ab' '\\0101'");
    expect(result.stdout).toBe("\b1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("takes only two digits when three would exceed a byte", async () => {
    // GNU tr reads \400 as \40 followed by 0, so space maps to space.
    const result = await run("printf 'a b0\\n' | tr ' 0' '\\400'");
    expect(result.stdout).toBe("a b0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("decodes \\a \\b \\f \\v", async () => {
    const result = await run("printf 'abcd\\n' | tr 'abcd' '\\a\\b\\f\\v'");
    expect(result.stdout).toBe("\x07\b\f\v\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("decodes an escaped backslash", async () => {
    const result = await run("printf 'a\\\\b\\n' | tr '\\\\' '/'");
    expect(result.stdout).toBe("a/b\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("deletes a range with octal endpoints", async () => {
    // B is past the end of the range, so it must survive.
    const result = await run("printf 'a\\001B\\037c\\n' | tr -d '\\000-\\037'");
    expect(result.stdout).toBe("aBc");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("continues after a range with octal endpoints", async () => {
    const result = await run("printf 'AB-1C\\n' | tr -d '\\101-\\102'");
    expect(result.stdout).toBe("-1C\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("translates between ranges with octal endpoints", async () => {
    const result = await run("echo xyz | tr 'x-z' '\\101-\\103'");
    expect(result.stdout).toBe("ABC\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["tr -d '\\101-\\077'", "A-?"],
    ["tr -d 'z-a'", "z-a"],
    ["tr 'a' 'z-a'", "z-a"],
  ])("rejects descending ranges in %s", async (command, range) => {
    const result = await run(`echo abc | ${command}`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `tr: range-endpoints of '${range}' are in reverse collating sequence order\n`,
    );
    expect(result.exitCode).toBe(1);
  });

  it("accepts equal escaped range endpoints", async () => {
    const result = await run("echo abc | tr '\\141-\\141' X");
    expect(result.stdout).toBe("Xbc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats an escaped dash as a literal, not a range", async () => {
    const result = await run("echo a-b-c | tr 'a\\-c' 'x_z'");
    expect(result.stdout).toBe("x_b_z\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("emits one byte for an octal escape above \\177", async () => {
    const env = new Bash({ files: {}, cwd: "/" });
    const result = await env.exec("echo X | tr X '\\377' > /out");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Array.from(await env.fs.readFileBuffer("/out"))).toEqual([
      0xff, 0x0a,
    ]);
  });

  it("deletes a byte above \\177", async () => {
    const env = new Bash({
      files: { "/in.bin": new Uint8Array([0x61, 0xff, 0x62, 0x0a]) },
      cwd: "/",
    });
    const result = await env.exec("tr -d '\\377' < /in.bin");
    expect(result.stdout).toBe("ab\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("deletes the bytes of a multibyte character with an octal range", async () => {
    const result = await run("echo café | tr -d '\\200-\\377'");
    expect(result.stdout).toBe("caf\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reads other SET characters as UTF-8 bytes beside a high octal escape", async () => {
    // é is the bytes \303\251, so it pairs with two characters of SET2.
    const result = await run("echo é | tr 'é\\377' 'xyz'");
    expect(result.stdout).toBe("xy\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("still matches by character without a high octal escape", async () => {
    const result = await run("echo é | tr 'é\\177' 'xyz'");
    expect(result.stdout).toBe("x\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps a trailing backslash literal", async () => {
    const result = await run("printf 'a\\\\b\\n' | tr 'a\\' 'xy'");
    expect(result.stdout).toBe("xyb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
