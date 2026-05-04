import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Real jq accepts JSON containing literal control characters inside strings,
// even though RFC 8259 forbids them. Real-world inputs (webhooks, copy-paste
// from terminals, log lines piped through `jq`) frequently contain unescaped
// tabs and newlines, so matching jq's permissive behavior here avoids
// surprising failures when our jq is dropped into existing pipelines.
describe("jq permissive control chars in JSON strings", () => {
  it("accepts a literal newline inside a string value", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"body":"first\nsecond"}\n' },
    });

    const result = await env.exec("jq -r '.body' /payload.json");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("first\nsecond\n");
    expect(result.exitCode).toBe(0);
  });

  it("accepts a literal tab inside a string value", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"body":"col1\tcol2"}\n' },
    });

    const result = await env.exec("jq -r '.body' /payload.json");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("col1\tcol2\n");
    expect(result.exitCode).toBe(0);
  });

  it("accepts a literal carriage return inside a string value", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"body":"a\rb"}\n' },
    });

    const result = await env.exec("jq -r '.body' /payload.json");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("a\rb\n");
    expect(result.exitCode).toBe(0);
  });

  it("preserves a real escape sequence next to a literal control char", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"body":"line1\\nline2\nline3"}\n' },
    });

    const result = await env.exec("jq -r '.body' /payload.json");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("line1\nline2\nline3\n");
    expect(result.exitCode).toBe(0);
  });

  it("does not rewrite control characters that appear outside strings", async () => {
    const env = new Bash({
      files: { "/payload.json": '{\n  "a": 1,\n  "b": 2\n}\n' },
    });

    const result = await env.exec("jq -c '.' /payload.json");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe('{"a":1,"b":2}\n');
    expect(result.exitCode).toBe(0);
  });

  it("handles concatenated JSON values where one contains a literal newline", async () => {
    const env = new Bash({
      files: {
        "/stream.json": '{"a":"x\ny"}{"a":"z"}\n',
      },
    });

    const result = await env.exec("jq -r '.a' /stream.json");

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("x\ny\nz\n");
    expect(result.exitCode).toBe(0);
  });
});
