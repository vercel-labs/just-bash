import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg searches stdin when no paths are given", () => {
  it("searches piped stdin instead of cwd", async () => {
    const env = new Bash({
      files: {
        // File exists but should NOT be searched — only stdin should be
        "/decoy.txt": "decoy line\n",
      },
    });
    const result = await env.exec(
      'printf "hello world\\ngoodbye\\n" | rg "hello"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello world");
    expect(result.stdout).not.toContain("decoy");
  });

  it("returns exit code 1 when stdin has no match", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec('echo "hello" | rg "xyz"');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("supports case-insensitive search on stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec('printf "Hello World\\n" | rg -i "hello"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello World");
  });

  it("supports inverted match on stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec(
      'printf "aaa\\nbbb\\nccc\\n" | rg -v "bbb"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("aaa");
    expect(result.stdout).toContain("ccc");
    expect(result.stdout).not.toContain("bbb");
  });

  it("supports count mode on stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec(
      'printf "foo\\nbar\\nfoo\\n" | rg -c "foo"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("2");
  });

  it("searches files when explicit path is given (not stdin)", async () => {
    const env = new Bash({
      files: { "/data.txt": "target line\n" },
    });
    const result = await env.exec(
      'echo "stdin content" | rg "target" /data.txt',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("target line");
  });

  it("supports multibyte UTF-8 patterns from piped stdin", async () => {
    const env = new Bash({ files: {} });
    const result = await env.exec("printf '한글 found\\nmiss\\n' | rg '한글'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("한글 found");
    expect(result.stdout).not.toContain("miss");
  });
});
