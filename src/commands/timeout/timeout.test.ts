import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("timeout command", () => {
  describe("basic functionality", () => {
    it("should run command that completes before timeout", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout 10 echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });

    it("should timeout slow command", async () => {
      const env = new Bash({
        sleep: async (ms) => {
          // Simulate actual sleep for testing
          await new Promise((r) => setTimeout(r, ms));
        },
      });

      const result = await env.exec("timeout 0.05 sleep 10");
      expect(result.exitCode).toBe(124);
    });

    it("should pass arguments to command", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout 10 echo one two three");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("one two three\n");
    });
  });

  describe("duration parsing", () => {
    it("should handle seconds (default)", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout 5 echo test");
      expect(result.exitCode).toBe(0);
    });

    it("should handle seconds suffix", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout 5s echo test");
      expect(result.exitCode).toBe(0);
    });

    it("should handle minutes suffix", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout 1m echo test");
      expect(result.exitCode).toBe(0);
    });

    it("should handle decimal durations", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout 0.5 echo test");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should error on missing operand", async () => {
      const env = new Bash();

      const result = await env.exec("timeout");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing operand");
    });

    it("should error on missing command", async () => {
      const env = new Bash();

      const result = await env.exec("timeout 5");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing operand");
    });

    it("should error on invalid duration", async () => {
      const env = new Bash();

      const result = await env.exec("timeout abc echo test");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid time interval");
    });

    it("should error on unknown option", async () => {
      const env = new Bash();

      const result = await env.exec("timeout --unknown 5 echo test");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unrecognized option");
    });
  });

  describe("options", () => {
    it("should ignore --foreground option", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout --foreground 10 echo test");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should ignore -k option", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout -k 5 10 echo test");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });

    it("should ignore -s option", async () => {
      const env = new Bash({
        sleep: async () => {},
      });

      const result = await env.exec("timeout -s KILL 10 echo test");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
    });
  });

  describe("help", () => {
    it("should show help with --help", async () => {
      const env = new Bash();

      const result = await env.exec("timeout --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("timeout");
      expect(result.stdout).toContain("DURATION");
    });
  });

  describe("shell injection via unquoted arguments (bug)", () => {
    it("&& in an argument must not chain a second command", async () => {
      const bash = new Bash();
      // timeout.ts only quotes args that contain spaces or tabs, so any other
      // shell metacharacter passes through raw.  ":&&echo" has no whitespace →
      // commandStr = ":&&echo INJECTED_VIA_ANDAND"
      // ctx.exec splits on `&&`, `:` succeeds, `echo INJECTED_VIA_ANDAND` runs.
      // Correct behaviour: ":&&echo" is treated as a single command name;
      // INJECTED_VIA_ANDAND must not appear in stdout.
      const result = await bash.exec(
        "timeout 10 ':&&echo' INJECTED_VIA_ANDAND",
      );
      expect(result.stdout).not.toContain("INJECTED_VIA_ANDAND");
    });

    it("pipe in an argument must not connect two commands", async () => {
      const bash = new Bash();
      // "|" contains no whitespace → passed raw.
      // commandStr = "echo secret | tr a-z A-Z"
      // ctx.exec pipes echo into tr and outputs "SECRET".
      // Correct behaviour: "|" is a literal argument to echo; stdout should
      // contain the pipe character, not the uppercased result.
      const result = await bash.exec(
        "timeout 10 'echo' 'secret' '|' 'tr' 'a-z' 'A-Z'",
      );
      expect(result.stdout).not.toBe("SECRET\n");
    });
  });
});
