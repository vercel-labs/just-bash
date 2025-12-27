import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("history command", () => {
  it("should show empty history initially", async () => {
    const env = new Bash();
    const result = await env.exec("history");
    // History is empty at start
    expect(result.exitCode).toBe(0);
  });

  it("should show help with --help", async () => {
    const env = new Bash();
    const result = await env.exec("history --help");
    expect(result.stdout).toContain("history");
    expect(result.stdout).toContain("command history");
    expect(result.exitCode).toBe(0);
  });

  it("should clear history with -c (within same exec)", async () => {
    const env = new Bash({
      env: { BASH_HISTORY: '["echo hello","ls -la"]' },
    });
    // history -c and verify in same exec (each exec is a new shell)
    const result = await env.exec("history -c; history");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("should display history with line numbers", async () => {
    const env = new Bash({
      env: { BASH_HISTORY: '["echo hello","ls -la"]' },
    });
    const result = await env.exec("history");
    expect(result.stdout).toContain("1");
    expect(result.stdout).toContain("echo hello");
    expect(result.stdout).toContain("2");
    expect(result.stdout).toContain("ls -la");
    expect(result.exitCode).toBe(0);
  });

  it("should limit output with numeric argument", async () => {
    const env = new Bash({
      env: { BASH_HISTORY: '["cmd1","cmd2","cmd3","cmd4","cmd5"]' },
    });
    const result = await env.exec("history 2");
    expect(result.stdout).toContain("cmd4");
    expect(result.stdout).toContain("cmd5");
    expect(result.stdout).not.toContain("cmd1");
    expect(result.exitCode).toBe(0);
  });
});
