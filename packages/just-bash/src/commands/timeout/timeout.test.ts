import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { _setTimeout } from "../../timers.js";

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
          await new Promise((r) => _setTimeout(r, ms));
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

  describe("cancellation", () => {
    it("should not produce output from command after timeout", async () => {
      const env = new Bash();

      // The inner command sleeps then writes — timeout should prevent the write
      const result = await env.exec(`
        timeout 0.01 bash -c 'sleep 0.05; echo SHOULD_NOT_APPEAR > /tmp/cancel-test'
        exit_code=$?
        if [ -f /tmp/cancel-test ]; then
          echo "LEAKED"
        else
          echo "CLEAN"
        fi
        echo "EXIT=$exit_code"
      `);

      expect(result.stdout).toBe("CLEAN\nEXIT=124\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should not accumulate stdout from canceled command", async () => {
      const env = new Bash();

      const result = await env.exec(`
        timeout 0.01 bash -c 'sleep 0.05; echo LEAKED_STDOUT'
      `);

      expect(result.exitCode).toBe(124);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    });

    it("should abort multi-statement scripts at statement boundary", async () => {
      const env = new Bash();

      const result = await env.exec(`
        timeout 0.01 bash -c 'sleep 0.05; echo A > /tmp/a; echo B > /tmp/b; echo C > /tmp/c'
        echo "EXIT=$?"
        [ -f /tmp/a ] && echo "A_EXISTS" || echo "A_ABSENT"
        [ -f /tmp/b ] && echo "B_EXISTS" || echo "B_ABSENT"
        [ -f /tmp/c ] && echo "C_EXISTS" || echo "C_ABSENT"
      `);

      expect(result.stdout).toBe("EXIT=124\nA_ABSENT\nB_ABSENT\nC_ABSENT\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("option parsing", () => {
    it.each([
      ["timeout 5 echo --help", "--help\n"],
      ["timeout -- 5 echo --help", "--help\n"],
      ["timeout -- 5 echo hello", "hello\n"],
      ["timeout --foreground -- 5 echo --help", "--help\n"],
      ["timeout --foreground 5 echo --help", "--help\n"],
      [
        "timeout -k 1 -s TERM 5 echo before --help after",
        "before --help after\n",
      ],
      ["timeout --kill-after=1 --signal=TERM 5 echo --help", "--help\n"],
      ["timeout 5 echo -h --version --help", "-h --version --help\n"],
    ])("should forward child arguments in %s", async (script, stdout) => {
      const result = await new Bash().exec(script);

      expect(result.stdout).toBe(stdout);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it.each([
      [
        "timeout invalid echo --help",
        "timeout: invalid time interval 'invalid'\n",
      ],
      ["timeout -- --help", "timeout: invalid time interval '--help'\n"],
      ["timeout --", "timeout: missing operand\n"],
      ["timeout -- 5", "timeout: missing operand\n"],
      [
        "timeout --unknown 5 echo --help",
        "timeout: unrecognized option '--unknown'\n",
      ],
    ])("should report timeout errors in %s", async (script, stderr) => {
      const result = await new Bash().exec(script);

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(stderr);
      expect(result.exitCode).toBe(1);
    });
  });

  describe("help", () => {
    it.each([
      "timeout --foreground --help",
      "timeout -s TERM --help",
    ])("should show timeout help in %s", async (script) => {
      const bash = new Bash();
      const help = await bash.exec("timeout --help");
      const result = await bash.exec(script);

      expect(result.stdout).toBe(help.stdout);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should show help with --help", async () => {
      const env = new Bash();

      const result = await env.exec("timeout --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("timeout");
      expect(result.stdout).toContain("DURATION");
    });
  });
});
