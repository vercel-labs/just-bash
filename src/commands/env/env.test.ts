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
    expect(result.stdout).toContain("PATH=/bin");
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
