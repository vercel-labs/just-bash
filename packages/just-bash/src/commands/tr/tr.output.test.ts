import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("tr output construction", () => {
  it.each([
    ["tr -d x", "é😀\0"],
    ["tr -s x", "é😀x\0"],
    ["tr x y", "é😀yy\0"],
    ["tr -s x y", "é😀y\0"],
    ["tr -c x y", "yyxxy"],
  ])("preserves codepoint traversal across batches: %s", async (script, unit) => {
    const env = new Bash();
    const result = await env.exec(script, { stdin: "é😀xx\0".repeat(8193) });
    expect(result.stdout).toBe(unit.repeat(8193));
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("squeezes astral codepoints across a batch boundary", async () => {
    const env = new Bash();
    const input = `${"x".repeat(32798)}😀😀😀z`;
    const result = await env.exec("tr -s 😀", { stdin: input });
    expect(result.stdout).toBe(`${"x".repeat(32798)}😀z`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("checks UTF-8 output bytes before appending a translated character", async () => {
    const env = new Bash({ executionLimits: { maxOutputSize: 5 } });
    const result = await env.exec("tr a 水", { stdin: "aa" });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: tr: output size limit exceeded (5 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("preserves large output while translating, deleting, and squeezing", async () => {
    const input = "x".repeat(1024 * 1024);
    const env = new Bash({ files: {}, cwd: "/" });

    const translated = await env.exec("tr x y", { stdin: input });
    expect(translated.stdout).toBe("y".repeat(input.length));
    expect(translated.stderr).toBe("");
    expect(translated.exitCode).toBe(0);

    const deleted = await env.exec("tr -d z", { stdin: input });
    expect(deleted.stdout).toBe(input);
    expect(deleted.stderr).toBe("");
    expect(deleted.exitCode).toBe(0);

    const squeezed = await env.exec("tr -s x y", { stdin: input });
    expect(squeezed.stdout).toBe("y");
    expect(squeezed.stderr).toBe("");
    expect(squeezed.exitCode).toBe(0);
  });
});
