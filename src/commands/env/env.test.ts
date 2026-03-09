import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("env command", () => {
  it("should print all environment variables", async () => {
    const env = new Bash({
      env: { FOO: "bar", BAZ: "qux" },
    });
    const result = await env.exec("env");
    expect(result.stdout).toContain("FOO=bar");
    expect(result.stdout).toContain("BAZ=qux");
    expect(result.exitCode).toBe(0);
  });

  it("should include default environment variables", async () => {
    const env = new Bash();
    const result = await env.exec("env");
    expect(result.stdout).toContain("HOME=/");
    expect(result.stdout).toContain("PATH=/usr/bin:/bin");
  });

  it("should show help with --help", async () => {
    const env = new Bash();
    const result = await env.exec("env --help");
    expect(result.stdout).toContain("env");
    expect(result.stdout).toContain("environment");
    expect(result.exitCode).toBe(0);
  });
});

describe("printenv command", () => {
  it("should print all environment variables without args", async () => {
    const env = new Bash({
      env: { FOO: "bar" },
    });
    const result = await env.exec("printenv");
    expect(result.stdout).toContain("FOO=bar");
    expect(result.exitCode).toBe(0);
  });

  it("should print specific variable value", async () => {
    const env = new Bash({
      env: { FOO: "bar", BAZ: "qux" },
    });
    const result = await env.exec("printenv FOO");
    expect(result.stdout).toBe("bar\n");
    expect(result.exitCode).toBe(0);
  });

  it("should print multiple variable values", async () => {
    const env = new Bash({
      env: { FOO: "bar", BAZ: "qux" },
    });
    const result = await env.exec("printenv FOO BAZ");
    expect(result.stdout).toBe("bar\nqux\n");
  });

  it("should return exit code 1 for missing variable", async () => {
    const env = new Bash();
    const result = await env.exec("printenv NONEXISTENT");
    expect(result.exitCode).toBe(1);
  });

  it("should show help with --help", async () => {
    const env = new Bash();
    const result = await env.exec("printenv --help");
    expect(result.stdout).toContain("printenv");
    expect(result.exitCode).toBe(0);
  });
});

describe("env command execution – shell injection (bug)", () => {
  it("semicolon in command name must not run a second command", async () => {
    const bash = new Bash();
    // env.ts inserts cmdName raw into the shell string it passes to ctx.exec().
    // Outer bash strips single-quotes, so env receives the literal string
    // "echo hello; echo INJECTED" as cmdName.  env.ts assembles:
    //   `command echo hello; echo INJECTED`
    // ctx.exec splits on `;` and both commands execute today.
    // Correct behaviour: the whole token is the command name – only "hello"
    // (or nothing) should appear; "INJECTED" must not.
    const result = await bash.exec("env 'echo hello; echo INJECTED'");
    expect(result.stdout).not.toContain("INJECTED");
  });

  it("&& in command name must not chain a second command", async () => {
    const bash = new Bash();
    // env receives ":&&echo" as cmdName.  env.ts assembles:
    //   `command :&&echo INJECTED_ANDAND`
    // ctx.exec interprets `&&`, `:` succeeds, and `echo INJECTED_ANDAND` runs.
    // Correct behaviour: ":&&echo" is an unknown command name; INJECTED_ANDAND
    // must not appear in stdout.
    const result = await bash.exec("env ':&&echo' INJECTED_ANDAND");
    expect(result.stdout).not.toContain("INJECTED_ANDAND");
  });
});

describe("env/printenv host isolation", () => {
  it("should not leak real host env vars via env", async () => {
    const bash = new Bash();
    const result = await bash.exec("env");
    // Should not contain common host env vars
    expect(result.stdout).not.toContain("NODE_ENV=");
    expect(result.stdout).not.toContain("SHELL=");
    expect(result.stdout).not.toContain("TERM=");
    expect(result.stdout).not.toContain("LANG=");
    expect(result.stdout).not.toContain("USER=");
  });

  it("should return virtual PATH, not host PATH", async () => {
    const bash = new Bash();
    const result = await bash.exec("printenv PATH");
    expect(result.stdout.trim()).toBe("/usr/bin:/bin");
    expect(result.stdout).not.toContain("/usr/local/bin");
  });
});
