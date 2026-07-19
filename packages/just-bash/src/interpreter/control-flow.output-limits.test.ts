import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ExecutionLimitError } from "./errors.js";

describe("compound control-flow output limits", () => {
  it("counts top-level UTF-8 bytes rather than UTF-16 code units", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 2 } });
    const result = await bash.exec("printf 한");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  const scripts = [
    { name: "for", script: "for i in 1 2; do echo 12345; done" },
    {
      name: "C-style for",
      script: "for ((i=0; i<2; i++)); do echo 12345; done",
    },
    {
      name: "while",
      script: "i=0; while ((i<2)); do echo 12345; i=$((i+1)); done",
    },
    {
      name: "until",
      script: 'i=0; until [ "$i" -ge 2 ]; do echo 12345; i=$((i+1)); done',
    },
    { name: "if", script: "if true; then echo 12345; echo 12345; fi" },
    {
      name: "case",
      script: "case x in x) echo 12345; echo 12345;; esac",
    },
  ];

  for (const { name, script } of scripts) {
    it(`checks ${name} output before concatenation`, async () => {
      const bash = new Bash({ executionLimits: { maxOutputSize: 10 } });
      const result = await bash.exec(script);

      expect(result.stdout).toBe("12345\n");
      expect(result.stderr).toBe(
        "bash: pipeline: total output size exceeded (>10 bytes), increase executionLimits.maxOutputSize\n",
      );
      expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    });
  }

  it("accounts stdout and stderr against one aggregate boundary", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 9 } });
    const result = await bash.exec(
      "for i in 1; do echo 1234; echo 5678 >&2; done",
    );

    expect(result.stdout).toBe("1234\n");
    expect(result.stderr).toBe(
      "bash: redirection: total output size exceeded (>9 bytes), increase executionLimits.maxOutputSize\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("keeps nested compound output bounded", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 10 } });
    const result = await bash.exec(
      "for i in 1; do while true; do echo 12345; echo 12345; break; done; done",
    );

    expect(result.stdout).toBe("12345\n");
    expect(result.stderr).toBe(
      "bash: pipeline: total output size exceeded (>10 bytes), increase executionLimits.maxOutputSize\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it.each([
    ["direct", "printf 123456789012"],
    ["if", "if true; then printf 123456789012; fi"],
    ["for", "for i in 1; do printf 123456789012; done"],
    ["C-style for", "for ((i=0; i<1; i++)); do printf 123456789012; done"],
    ["while", "i=0; while ((i<1)); do printf 123456789012; i=$((i+1)); done"],
    [
      "until",
      'i=0; until [ "$i" -ge 1 ]; do printf 123456789012; i=$((i+1)); done',
    ],
  ])("does not double-charge output relayed through %s", async (_name, script) => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 12 } });
    const result = await bash.exec(script);

    expect(result).toMatchObject({
      stdout: "123456789012",
      stderr: "",
      exitCode: 0,
    });
  });
});
