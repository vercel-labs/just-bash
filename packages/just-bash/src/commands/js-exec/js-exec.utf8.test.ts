import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec utf8 stdin/code handling", () => {
  it(
    "preserves UTF-8 when JavaScript source is provided via stdin",
    { timeout: 30000 },
    async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("echo 'console.log(\"한국\")' | js-exec");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("한국\n");
    },
  );

  it(
    "preserves UTF-8 when inline code is provided via -c",
    { timeout: 30000 },
    async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "console.log('한')"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("한\n");
    },
  );

  it(
    "preserves UTF-8 for runtime stdin passed from QuickJS exec",
    { timeout: 30000 },
    async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "const { execSync } = require('child_process'); console.log(execSync('bash -c \\\"cat\\\"', { stdin: '한글😀' }));"`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("한글😀\n");
    },
  );
});
