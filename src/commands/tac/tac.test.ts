import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tac command", () => {
  it("should reverse lines from stdin", async () => {
    const env = new Bash();
    const result = await env.exec('echo -e "a\\nb\\nc" | tac');
    expect(result.stdout).toBe("c\nb\na\n");
    expect(result.exitCode).toBe(0);
  });

  it("should handle single line", async () => {
    const env = new Bash();
    const result = await env.exec('echo "hello" | tac');
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("should handle empty input", async () => {
    const env = new Bash();
    const result = await env.exec('echo -n "" | tac');
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read from file", async () => {
    const env = new Bash();
    await env.exec('echo -e "line1\\nline2\\nline3" > /tmp/test.txt');
    const result = await env.exec("tac /tmp/test.txt");
    expect(result.stdout).toBe("line3\nline2\nline1\n");
    expect(result.exitCode).toBe(0);
  });

  it("should error on non-existent file", async () => {
    const env = new Bash();
    const result = await env.exec("tac /nonexistent/file.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No such file or directory");
  });
});
