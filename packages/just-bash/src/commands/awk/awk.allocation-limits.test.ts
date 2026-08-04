import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("AWK prospective allocation limits", () => {
  it.each([
    ["width", `awk 'BEGIN { s=sprintf("%*s", 65, "x") }'`],
    ["precision", `awk 'BEGIN { s=sprintf("%.*f", 65, 1) }'`],
  ])("rejects dynamic printf %s before padding", async (_kind, script) => {
    const bash = new Bash({ executionLimits: { maxStringLength: 64 } });
    const result = await bash.exec(script);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `awk: printf ${_kind} limit exceeded (64 bytes)\n`,
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("bounds cumulative sprintf output, not only each directive", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 64 } });
    const result = await bash.exec(
      `awk 'BEGIN { s=sprintf("%40s%40s", "x", "y") }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "awk: formatted string size limit exceeded (64 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects unsupported floating-point precision before the native formatter", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 1_000 } });
    const result = await bash.exec(`awk 'BEGIN { s=sprintf("%.101f", 1) }'`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "awk: printf floating-point precision limit exceeded (100 digits)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("bounds global substitution while producing replacements", async () => {
    const target = "a".repeat(64);
    const bash = new Bash({ executionLimits: { maxStringLength: 128 } });
    const result = await bash.exec(
      `awk 'BEGIN { s="${target}"; gsub(/a/, "xxx", s) }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: string size limit exceeded (128 bytes)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("stops split before exceeding maxArrayElements", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 3 } });
    const result = await bash.exec(
      `awk 'BEGIN { split("a,b,c,d", values, ",") }'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: array element limit exceeded (3)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("charges input records against the AWK work limit", async () => {
    const bash = new Bash({ executionLimits: { maxAwkIterations: 2 } });
    const result = await bash.exec("awk '{ print }'", {
      stdin: "one\ntwo\nthree\n",
    });
    expect(result.stdout).toBe("one\ntwo\n");
    expect(result.stderr).toBe("awk: record limit exceeded (2)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("rejects record arrays before splitting beyond maxArrayElements", async () => {
    const bash = new Bash({
      files: { "/records": "one\ntwo\nthree\n" },
      executionLimits: { maxArrayElements: 2 },
    });
    const result = await bash.exec("awk '{ print }' /records");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: record array limit exceeded (2)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("does not retain all input files before processing", async () => {
    const bash = new Bash({
      files: {
        "/first": "aaaaaaaaaaaaaaaaaaaa",
        "/second": "bbbbbbbbbbbbbbbbbbbb",
      },
      executionLimits: { maxStringLength: 32 },
    });
    const result = await bash.exec("awk '{ print }' /first /second");
    expect(result.stdout).toBe("aaaaaaaaaaaaaaaaaaaa\n");
    expect(result.stderr).toBe(
      "awk: aggregate input size limit exceeded (32 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });
});
