import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sed replacement escaped backslash", () => {
  it("keeps a literal backslash before a backreference", async () => {
    const env = new Bash({ files: { "/test.txt": "x\n" }, cwd: "/" });
    const result = await env.exec("sed 's/\\(x\\)/\\\\\\1/' /test.txt");
    expect(result.stdout).toBe("\\x\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("quotes metacharacters like autoconf config.status", async () => {
    const env = new Bash({
      files: { "/test.txt": 'a\\(b$c"d\n' },
      cwd: "/",
    });
    const result = await env.exec(
      "sed 's/\\([\"`$\\\\]\\)/\\\\\\1/g' /test.txt",
    );
    expect(result.stdout).toBe('a\\\\(b\\$c\\"d\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps a literal backslash before the whole match", async () => {
    const env = new Bash({ files: { "/test.txt": "x\n" }, cwd: "/" });
    const result = await env.exec("sed 's/x/\\\\&/' /test.txt");
    expect(result.stdout).toBe("\\x\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("replaces with a single literal backslash", async () => {
    const env = new Bash({ files: { "/test.txt": "a/b\n" }, cwd: "/" });
    const result = await env.exec("sed 's,/,\\\\,' /test.txt");
    expect(result.stdout).toBe("a\\b\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
