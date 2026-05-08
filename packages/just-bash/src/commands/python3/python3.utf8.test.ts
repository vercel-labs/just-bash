import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 utf8 stdin/code paths", () => {
  it(
    "preserves UTF-8 when Python code is provided via stdin",
    { timeout: 60000 },
    async () => {
    const env = new Bash({
      python: true,
      executionLimits: { maxPythonTimeoutMs: 30000 },
    });
    const result = await env.exec(`echo 'print("한국")' | python3`);

    expect(result.stdout).toBe("한국\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    },
  );

  it(
    "preserves UTF-8 when runtime stdin is consumed by Python",
    { timeout: 60000 },
    async () => {
    const env = new Bash({
      python: true,
      executionLimits: { maxPythonTimeoutMs: 30000 },
    });
    const result = await env.exec(
      `echo "한국" | python3 -c "import sys; print(sys.stdin.read().strip())"`,
    );

    expect(result.stdout).toBe("한국\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    },
  );

  it(
    "preserves UTF-8 when -c code argument contains Korean literal",
    { timeout: 60000 },
    async () => {
    const env = new Bash({
      python: true,
      executionLimits: { maxPythonTimeoutMs: 30000 },
    });
    const result = await env.exec(`python3 -c "print('한')"`);

    expect(result.stdout).toBe("한\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    },
  );
});
