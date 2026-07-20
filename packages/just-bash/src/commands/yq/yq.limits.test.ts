import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("yq execution limits", () => {
  it("shares input node and document accounting across YAML slurp documents", async () => {
    const env = new Bash({
      files: { "/data.yaml": "---\na: 1\n---\nb: 2\n---\nc: 3\n" },
      executionLimits: { maxQueryElements: 5 },
    });

    const result = await env.exec("yq -s '.' /data.yaml");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toBe("yq: query input element limit exceeded (5)\n");
  });

  it("bounds JSON escaping during serialization", async () => {
    const env = new Bash({
      files: { "/data.yaml": `value: "${"\\n".repeat(100)}"\n` },
      executionLimits: { maxOutputSize: 80 },
    });

    const result = await env.exec("yq -o json '.' /data.yaml");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toBe("yq: output size limit exceeded (79 bytes)\n");
  });

  it("reserves eager YAML serialization against the output budget", async () => {
    const env = new Bash({
      files: { "/data.yaml": `value: ${"x".repeat(100)}\n` },
      executionLimits: { maxOutputSize: 80 },
    });

    const result = await env.exec("yq '.' /data.yaml");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toBe("yq: output size limit exceeded (79 bytes)\n");
  });

  it("keeps configurable JSON indentation compatible", async () => {
    const env = new Bash();

    const result = await env.exec(
      `printf 'a: 1\\n' | yq -o json --indent=4 '.'`,
    );

    expect(result).toMatchObject({
      stdout: '{\n    "a": 1\n}\n',
      stderr: "",
      exitCode: 0,
    });
  });

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
