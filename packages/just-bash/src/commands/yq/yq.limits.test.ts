import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("yq execution limits", () => {
  it("enforces maxStringLength inside query string multiplication", async () => {
    const env = new Bash({
      executionLimits: { maxStringLength: 64 },
    });

    const result = await env.exec(`yq -n '"12345678" * 9'`);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("yq: string size limit exceeded (64 bytes)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("reserves UTF-8 output and the final newline prospectively", async () => {
    const exact = new Bash({
      executionLimits: { maxStringLength: 100, maxOutputSize: 3 },
    });
    const accepted = await exact.exec(`yq -n -r '"é"'`);
    expect(accepted.stdout).toBe("é\n");
    expect(accepted.stderr).toBe("");
    expect(accepted.exitCode).toBe(0);

    const over = new Bash({
      executionLimits: { maxStringLength: 100, maxOutputSize: 2 },
    });
    const rejected = await over.exec(`yq -n -r '"é"'`);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toBe(
      "bash: pipeline: total output size exceeded (>2 bytes), increase executionLimits.maxOutputSize\n",
    );
    expect(rejected.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });
});
