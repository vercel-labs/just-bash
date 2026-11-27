import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import {
  decodeByteEscapes,
  readOctalOrHexEscape,
  readZeroOctalOrHexEscape,
} from "./encoding.js";

describe("decodeByteEscapes", () => {
  it("decodes a run of escapes as UTF-8", () => {
    expect(decodeByteEscapes("\\303\\251!", 0, readOctalOrHexEscape)).toEqual({
      text: "é",
      next: 8,
    });
  });

  it("keeps an invalid byte as its Latin-1 character beside a valid one", () => {
    expect(
      decodeByteEscapes("\\377\\303\\251", 0, readOctalOrHexEscape).text,
    ).toBe("\xffé");
  });

  it("keeps the low eight bits of a value above \\377", () => {
    // 0o501 is 321; its low byte is 65, A.
    expect(decodeByteEscapes("\\501", 0, readOctalOrHexEscape).text).toBe("A");
  });

  it("mixes octal and hex escapes in one run", () => {
    expect(decodeByteEscapes("\\xc3\\251", 0, readOctalOrHexEscape).text).toBe(
      "é",
    );
  });

  it("reads \\0NNN, and \\0 alone as NUL, for echo -e", () => {
    expect(
      decodeByteEscapes("\\0303\\0251", 0, readZeroOctalOrHexEscape),
    ).toEqual({ text: "é", next: 10 });
    expect(decodeByteEscapes("\\0x", 0, readZeroOctalOrHexEscape)).toEqual({
      text: "\0",
      next: 2,
    });
    expect(readZeroOctalOrHexEscape("\\303", 0)).toBeNull();
  });

  it("reads nothing when no escape starts the run", () => {
    expect(decodeByteEscapes("abc", 0, readOctalOrHexEscape)).toEqual({
      text: "",
      next: 0,
    });
  });
});

describe("byte escapes that spell UTF-8", () => {
  it.each([
    "printf '\\303\\251\\n'",
    "printf '\\xc3\\251\\n'",
    "printf '%b\\n' '\\0303\\0251'",
    "printf '%b\\n' '\\303\\251'",
    "echo -e '\\0303\\0251'",
    "echo -e '\\xc3\\xa9'",
    "echo $'\\303\\251'",
    "echo $'\\xc3\\251'",
  ])("%s writes the bytes of é", async (script) => {
    // cat -v shows each byte, so a character mangled into U+00C3 U+00A9
    // (M-CM-^CM-BM-)) can't pass for é (M-CM-)).
    const result = await new Bash().exec(`${script} | cat -v`);
    expect(result.stdout).toBe("M-CM-)\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("writes the character's bytes, not each byte as a character", async () => {
    const env = new Bash();
    await env.exec("printf '\\303\\251' > /out");
    expect(Array.from(await env.fs.readFileBuffer("/out"))).toEqual([
      0xc3, 0xa9,
    ]);
  });

  it("decodes a three-byte character", async () => {
    const result = await new Bash().exec("echo $'\\342\\202\\254' | cat -v");
    expect(result.stdout).toBe("M-bM-^BM-,\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("decodes a four-byte character", async () => {
    const result = await new Bash().exec(
      "printf '\\360\\237\\230\\200\\n' | cat -v",
    );
    expect(result.stdout).toBe("M-pM-^_M-^XM-^@\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("stops at \\c after a run", async () => {
    const result = await new Bash().exec(
      "printf '%b' '\\303\\251\\cX' | cat -v; echo -e '\\xc3\\xa9\\cX' | cat -v",
    );
    expect(result.stdout).toBe("M-CM-)M-CM-)");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps the low byte of an octal value above \\377", async () => {
    // \\501 is 321, whose low byte is 65, A.
    const result = await new Bash().exec("printf '\\501\\n'");
    expect(result.stdout).toBe("A\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps a % made by an escape literal in a printf format", async () => {
    const result = await new Bash().exec(
      "printf '\\045s|\\x25s|\\445s|\\u25s\\n' a b c d",
    );
    expect(result.stdout).toBe("%s|%s|%s|%s\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps a % made by an escape literal in find -printf", async () => {
    const env = new Bash({ files: { "/d/f": "" } });
    const result = await env.exec("find /d/f -printf '\\045p\\n'");
    expect(result.stdout).toBe("%p\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("decodes octal escapes in find -printf", async () => {
    const env = new Bash({ files: { "/d/f": "" } });
    const result = await env.exec("find /d/f -printf '\\303\\251\\n' | cat -v");
    expect(result.stdout).toBe("M-CM-)\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reads a one-digit hex escape in a printf format", async () => {
    const result = await new Bash().exec("printf 'a\\x9z\\n'");
    expect(result.stdout).toBe("a\tz\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps \\x literal before a sign or space in $'...'", async () => {
    const result = await new Bash().exec("echo $'\\x-1|\\x 1|\\x+1'");
    expect(result.stdout).toBe("\\x-1|\\x 1|\\x+1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("ends a $'...' hex escape at the first non-hex character", async () => {
    const result = await new Bash().exec("echo $'\\x4g'");
    expect(result.stdout).toBe("\x04g\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
