import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sed utf8 handling", () => {
  const SOURCE = "한글 café 東京 emoji😀 old\n";
  const REPLACED = "한글 café 東京 emoji😀 new\n";
  const SOURCE_BYTES =
    "\\xed\\x95\\x9c\\xea\\xb8\\x80 caf\\xc3\\xa9 \\xe6\\x9d\\xb1\\xe4\\xba\\xac emoji\\xf0\\x9f\\x98\\x80 old\\n";

  it("preserves UTF-8 bytes for substitution from stdin", async () => {
    const env = new Bash();

    const result = await env.exec(
      `printf '${SOURCE_BYTES}' | sed 's/old/new/'`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(REPLACED);
  });

  it("preserves UTF-8 bytes for -n pattern print from stdin", async () => {
    const env = new Bash();

    const result = await env.exec(`printf '${SOURCE_BYTES}' | sed -n '/emoji/p'`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(SOURCE);
  });

  it("preserves UTF-8 bytes for substitution from file input", async () => {
    const env = new Bash();
    await env.exec(`printf '${SOURCE_BYTES}' > /input.txt`);

    const result = await env.exec("sed 's/old/new/' /input.txt");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(REPLACED);
  });

  it("preserves UTF-8 bytes for -n pattern print from file input", async () => {
    const env = new Bash();
    await env.exec(`printf '${SOURCE_BYTES}' > /input.txt`);

    const result = await env.exec("sed -n '/emoji/p' /input.txt");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(SOURCE);
  });
});
