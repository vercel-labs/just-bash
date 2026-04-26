import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Tests for shell-like functionality in BashEnv.
 * Note: Each exec is a new shell - state (cd, export) does not persist across execs.
 * The actual interactive shell is tested manually.
 */
describe("Shell functionality", () => {
  describe("cd command", () => {
    it("should change directory within same exec", async () => {
      const env = new Bash({
        files: { "/home/user/test/.keep": "" },
        cwd: "/home/user",
      });

      const result = await env.exec("cd test; pwd");
      expect(result.stdout).toBe("/home/user/test\n");
    });

    it("cd does not persist across exec calls", async () => {
      const env = new Bash({
        files: { "/home/user/test/.keep": "" },
        cwd: "/home/user",
      });

      await env.exec("cd test");
      // Each exec is a new shell
      expect(env.getCwd()).toBe("/home/user");
    });

    it("should support cd - within same exec", async () => {
      const env = new Bash({
        files: {
          "/dir1/.keep": "",
          "/dir2/.keep": "",
        },
        cwd: "/",
      });

      const result = await env.exec("cd /dir1; cd /dir2; cd -; pwd");
      expect(result.stdout).toContain("/dir1");
    });

    it("should support cd ~", async () => {
      const env = new Bash({
        files: { "/home/user/.keep": "" },
        cwd: "/tmp",
        env: { HOME: "/home/user" },
      });

      const result = await env.exec("cd ~; pwd");
      expect(result.stdout).toBe("/home/user\n");
    });

    it("should support cd without args", async () => {
      const env = new Bash({
        files: { "/home/user/.keep": "" },
        cwd: "/tmp",
        env: { HOME: "/home/user" },
      });

      const result = await env.exec("cd; pwd");
      expect(result.stdout).toBe("/home/user\n");
    });

    it("should support cd ..", async () => {
      const env = new Bash({
        files: { "/a/b/c/.keep": "" },
        cwd: "/a/b/c",
      });

      const result = await env.exec("cd ..; pwd");
      expect(result.stdout).toBe("/a/b\n");
    });

    it("should support cd with multiple .. in path", async () => {
      const env = new Bash({
        files: { "/a/b/c/d/.keep": "" },
        cwd: "/a/b/c/d",
      });

      const result = await env.exec("cd ../..; pwd");
      expect(result.stdout).toBe("/a/b\n");
    });
  });

  describe("pwd command", () => {
    it("should return current directory", async () => {
      const env = new Bash({
        cwd: "/home/user",
      });

      const result = await env.exec("pwd");
      expect(result.stdout).toBe("/home/user\n");
    });

    it("should reflect cd changes within same exec", async () => {
      const env = new Bash({
        files: { "/var/log/.keep": "" },
        cwd: "/",
      });

      const result = await env.exec("cd /var/log; pwd");
      expect(result.stdout).toBe("/var/log\n");
    });
  });

  describe("command chaining", () => {
    it("should support && chaining", async () => {
      const env = new Bash({
        files: { "/test/.keep": "" },
        cwd: "/",
      });

      const result = await env.exec("cd /test && pwd");
      expect(result.stdout).toBe("/test\n");
      // cd doesn't persist across execs
      expect(env.getCwd()).toBe("/");
    });

    it("should stop && chain on failure", async () => {
      const env = new Bash({
        cwd: "/",
      });

      const result = await env.exec("cd /nonexistent && pwd");
      expect(result.exitCode).toBe(1);
      expect(env.getCwd()).toBe("/");
    });

    it("should support || chaining", async () => {
      const env = new Bash({
        files: { "/fallback/.keep": "" },
        cwd: "/",
      });

      const result = await env.exec("cd /nonexistent || cd /fallback && pwd");
      expect(result.stdout).toBe("/fallback\n");
      // cd doesn't persist across execs
      expect(env.getCwd()).toBe("/");
    });

    it("should support ; chaining", async () => {
      const env = new Bash({
        files: { "/test/.keep": "" },
        cwd: "/",
      });

      const result = await env.exec("cd /test ; pwd");
      expect(result.stdout).toBe("/test\n");
    });
  });

  describe("environment variables", () => {
    it("should support export within same exec", async () => {
      const env = new Bash();

      const result = await env.exec("export MY_VAR=hello; echo $MY_VAR");
      expect(result.stdout).toBe("hello\n");
    });

    it("export does not persist across exec calls", async () => {
      const env = new Bash();

      await env.exec("export MY_VAR=hello");
      const result = await env.exec("echo $MY_VAR");
      expect(result.stdout).toBe("\n");
    });

    it("should support unset within same exec", async () => {
      const env = new Bash({
        env: { MY_VAR: "hello" },
      });

      const result = await env.exec("unset MY_VAR; echo $MY_VAR");
      expect(result.stdout).toBe("\n");
    });

    it("initial env vars are available in every exec", async () => {
      const env = new Bash({
        env: { SHARED: "value" },
      });

      const result1 = await env.exec("echo $SHARED");
      const result2 = await env.exec("echo $SHARED");
      expect(result1.stdout).toBe("value\n");
      expect(result2.stdout).toBe("value\n");
    });
  });

  describe("exit command", () => {
    it("should return exit code 0 by default", async () => {
      const env = new Bash();
      const result = await env.exec("exit");
      expect(result.exitCode).toBe(0);
    });

    it("should return specified exit code", async () => {
      const env = new Bash();
      const result = await env.exec("exit 42");
      expect(result.exitCode).toBe(42);
    });
  });
});
