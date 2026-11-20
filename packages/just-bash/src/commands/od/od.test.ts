import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("od command", () => {
  it("should dump stdin in octal format", async () => {
    const env = new Bash();
    const result = await env.exec('echo -n "AB" | od');
    // Native default is a little-endian 16-bit octal word.
    expect(result.stdout).toBe("0000000 041101\n0000002\n");
    expect(result.exitCode).toBe(0);
  });

  it("should show character mode with -c", async () => {
    const env = new Bash();
    const result = await env.exec('echo -n "hi" | od -c');
    // Character mode uses 4-char fields (3 spaces + char for printable)
    expect(result.stdout).toBe("0000000   h   i\n0000002\n");
    expect(result.exitCode).toBe(0);
  });

  it("should show escape sequences in character mode", async () => {
    const env = new Bash();
    const result = await env.exec('echo "hello" | od -c');
    // Character mode uses 4-char fields (2 spaces + 2-char escape sequence)
    expect(result.stdout).toBe("0000000   h   e   l   l   o  \\n\n0000006\n");
    expect(result.exitCode).toBe(0);
  });

  it("should suppress addresses with -An", async () => {
    const env = new Bash();
    const result = await env.exec('echo -n "A" | od -An');
    // A short final word is padded with a zero byte.
    expect(result.stdout).toBe(" 000101\n");
    expect(result.exitCode).toBe(0);
  });

  it("should read from file", async () => {
    const env = new Bash();
    await env.exec('echo -n "test" > /tmp/od-test.txt');
    const result = await env.exec("od /tmp/od-test.txt");
    // Native default octal words for the bytes in "test".
    expect(result.stdout).toBe("0000000 062564 072163\n0000004\n");
    expect(result.exitCode).toBe(0);
  });

  it("concatenates every file operand in order", async () => {
    const env = new Bash({ files: { "/a": "A", "/b": "B" } });
    const result = await env.exec("od /a /b");
    expect(result.stdout).toBe("0000000 041101\n0000002\n");
  });

  it("honors stdin operands between file operands", async () => {
    const env = new Bash({ files: { "/a": "A", "/b": "B" } });
    const result = await env.exec("echo -n X | od /a - /b");
    expect(result.stdout).toBe("0000000 054101 000102\n0000003\n");
  });

  it.each([
    "maxLoopIterations",
    "maxTraversalWork",
  ])("limits byte formatting through %s", async (limit) => {
    const env = new Bash({
      files: { "/input": "abc" },
      executionLimits: { [limit]: 5 },
    });
    const result = await env.exec("od -An -t x1 -t c /input");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: od: format work limit exceeded (5)\n");
    expect(result.exitCode).toBe(126);
  });

  it("should error on non-existent file", async () => {
    const env = new Bash();
    const result = await env.exec("od /nonexistent/file.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "od: /nonexistent/file.txt: No such file or directory\n",
    );
  });
});
