import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yes", () => {
  describe("output", () => {
    it("repeats y by default", async () => {
      const env = new Bash();
      const result = await env.exec("yes | head -3");
      expect(result.stdout).toBe("y\ny\ny\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("repeats a single operand", async () => {
      const env = new Bash();
      const result = await env.exec("yes n | head -2");
      expect(result.stdout).toBe("n\nn\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("joins multiple operands with a single space", async () => {
      const env = new Bash();
      const result = await env.exec("yes a b | head -2");
      expect(result.stdout).toBe("a b\na b\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("keeps empty operands, printing bare newlines", async () => {
      const env = new Bash();
      const result = await env.exec("yes '' | head -2 | wc -c");
      expect(result.stdout).toBe("2\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("treats a lone dash as an operand", async () => {
      const env = new Bash();
      const result = await env.exec("yes - | head -1");
      expect(result.stdout).toBe("-\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("treats operands after -- literally", async () => {
      const env = new Bash();
      const result = await env.exec("yes -- -x --help | head -1");
      expect(result.stdout).toBe("-x --help\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("feeds a consumer that reads every line", async () => {
      const env = new Bash({ executionLimits: { maxLoopIterations: 7 } });
      const result = await env.exec("yes | wc -l");
      expect(result.stdout).toBe("7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("bounded stream", () => {
    it("stops after maxLoopIterations lines", async () => {
      const env = new Bash({ executionLimits: { maxLoopIterations: 3 } });
      const result = await env.exec("yes");
      expect(result.stdout).toBe("y\ny\ny\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("stops earlier when the output size limit binds first", async () => {
      const env = new Bash({
        executionLimits: { maxLoopIterations: 1000, maxOutputSize: 9 },
      });
      const result = await env.exec("yes ab");
      expect(result.stdout).toBe("ab\nab\nab\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("counts UTF-8 bytes, not characters, against the size limit", async () => {
      const env = new Bash({
        executionLimits: { maxLoopIterations: 1000, maxOutputSize: 12 },
      });
      // "é\n" is 3 bytes, so 12 bytes allows 4 lines.
      const result = await env.exec("yes é | wc -l");
      expect(result.stdout).toBe("4\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("emits nothing when no iteration is permitted", async () => {
      const env = new Bash({ executionLimits: { maxLoopIterations: 0 } });
      const result = await env.exec("yes");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("charges the joined operands, not just the repetition", async () => {
      const env = new Bash({
        executionLimits: { maxLoopIterations: 1, maxOutputSize: 8 },
      });
      // Every operand fits on its own, but the line they build together does
      // not, so the join is what reports the limit.
      const result = await env.exec("yes aaaa bbbb cccc");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: yes: output size limit exceeded (8 bytes)\n",
      );
      expect(result.exitCode).toBe(126);
    });

    it("counts the newline against the line budget", async () => {
      const env = new Bash({
        executionLimits: { maxLoopIterations: 1, maxOutputSize: 4 },
      });
      // "abcd" is exactly the budget, so "abcd\n" cannot fit.
      const result = await env.exec("yes abcd");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: yes: output size limit exceeded (4 bytes)\n",
      );
      expect(result.exitCode).toBe(126);
    });

    it("reports the output limit when one line does not fit", async () => {
      const env = new Bash({ executionLimits: { maxOutputSize: 2 } });
      const result = await env.exec("yes abc");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: yes: output size limit exceeded (2 bytes)\n",
      );
      expect(result.exitCode).toBe(126);
    });
  });

  describe("options", () => {
    it("prints help for --help", async () => {
      const env = new Bash();
      const result = await env.exec("yes --help");
      expect(result.stdout).toContain("yes - output a string repeatedly");
      expect(result.stdout).toContain("Usage: yes [STRING]...");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("prints help even when --help follows an operand", async () => {
      const env = new Bash();
      const result = await env.exec("yes a --help");
      expect(result.stdout).toContain("Usage: yes [STRING]...");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("errors on an unknown short option", async () => {
      const env = new Bash();
      const result = await env.exec("yes -x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("yes: invalid option -- 'x'\n");
      expect(result.exitCode).toBe(1);
    });

    it("names the first letter of a grouped short option", async () => {
      const env = new Bash();
      const result = await env.exec("yes -xy");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("yes: invalid option -- 'x'\n");
      expect(result.exitCode).toBe(1);
    });

    it("errors on an unknown long option", async () => {
      const env = new Bash();
      const result = await env.exec("yes --forever");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("yes: unrecognized option '--forever'\n");
      expect(result.exitCode).toBe(1);
    });

    it("errors on an option that follows an operand", async () => {
      const env = new Bash();
      const result = await env.exec("yes a -x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("yes: invalid option -- 'x'\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("integration", () => {
    it("auto-confirms a reader in a pipeline", async () => {
      const env = new Bash();
      const result = await env.exec("yes | head -2 | tr 'y' 'Y' | tr -d '\\n'");
      expect(result.stdout).toBe("YY");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("redirects to a file", async () => {
      const env = new Bash({ executionLimits: { maxLoopIterations: 2 } });
      const result = await env.exec("yes ok > out.txt && cat out.txt");
      expect(result.stdout).toBe("ok\nok\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("is reported by which", async () => {
      const env = new Bash();
      const result = await env.exec("which yes");
      expect(result.stdout).toBe("/usr/bin/yes\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
