import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import { utf8ByteLength } from "../encoding.js";
import { ExecutionLimitError } from "./errors.js";

describe("DeepSec follow-up interpreter resource limits", () => {
  it("bounds cumulative literal and expanded argv cardinality", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 2 } });
    const result = await bash.exec(": one two three");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "expanded argument element limit exceeded (2)",
    );

    const injected = await new Bash({
      executionLimits: { maxArrayElements: 1 },
    }).exec(":", { args: ["one", "two"] });
    expect(injected.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(injected.stderr).toContain(
      "expanded argument element limit exceeded (1)",
    );
  });

  it("charges the command boundary below, at, and above the limit", async () => {
    const bash = new Bash({ executionLimits: { maxCommandCount: 2 } });

    expect((await bash.exec(":")).exitCode).toBe(0);
    expect((await bash.exec(": && :")).exitCode).toBe(0);
    const above = await bash.exec(": && : && :");
    expect(above.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(above.stderr).toContain("too many commands executed");
  });

  it("bounds quoted readonly parsing before mutation", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 2 } });
    const result = await bash.exec("builtin readonly 'items=(a b c)'");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("array element limit exceeded (2)");
    expect((await bash.exec("declare -p items 2>/dev/null")).stdout).toBe("");
  });

  it("bounds dynamically dispatched local array assignment and append", async () => {
    const assignment = await new Bash({
      executionLimits: { maxArrayElements: 2 },
    }).exec("f() { builtin local 'items=(a b c)'; }; f");
    expect(assignment.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(assignment.stderr).toContain("array element limit exceeded (2)");

    const append = await new Bash({
      executionLimits: { maxArrayElements: 2 },
    }).exec("f() { local items=(a b); builtin local 'items+=(c)'; }; f");
    expect(append.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(append.stderr).toContain("array element limit exceeded (2)");
  });

  it("rolls back an append that would exceed persistent cardinality", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 2 } });
    const result = await bash.exec("items=(old); items+=(new extra)");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("array element limit exceeded (2)");
  });

  it("rejects negative mapfile origins", async () => {
    const bash = new Bash();
    const result = await bash.exec("printf 'a\\nb\\n' | mapfile -O -2 values");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid array origin");
  });

  it("enforces mapfile line bytes below, at, and above the limit", async () => {
    for (const [value, allowed] of [
      ["1234567", true],
      ["12345678", true],
      ["123456789", false],
    ] as const) {
      const bash = new Bash({
        files: { "/f": value },
        executionLimits: { maxStringLength: 8 },
      });
      const result = await bash.exec("mapfile a < /f");
      expect(result.exitCode === 0).toBe(allowed);
      if (!allowed) expect(result.stderr).toContain("string length limit");
    }
  });

  it("enforces read value bytes from redirected input", async () => {
    const bash = new Bash({
      files: { "/f": "123456789" },
      executionLimits: { maxStringLength: 8 },
    });
    const result = await bash.exec("read v < /f");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("read: string length limit exceeded");
  });

  it("bounds cumulative fields across separately split word segments", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 3 } });
    const result = await bash.exec(
      "a='1 2'; b='3 4'; c='5 6'; printf '%s\\n' $a$b$c",
    );

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "word splitting element limit exceeded (3)",
    );
  });

  it("bounds repeated completion actions before output construction", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 30 } });
    expect((await bash.exec("compgen -A keyword")).exitCode).toBe(0);

    const result = await bash.exec("compgen -A keyword -A keyword");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("completion element limit exceeded (30)");
  });

  it("bounds completion producers while preserving at-limit results", async () => {
    const atLimit = await new Bash({
      files: { "/aa": "", "/ab": "" },
      executionLimits: { maxArrayElements: 2 },
    }).exec("compgen -f a");
    expect(atLimit).toMatchObject({
      stdout: "aa\nab\n",
      stderr: "",
      exitCode: 0,
    });

    const aboveLimit = await new Bash({
      files: { "/aa": "", "/ab": "", "/ac": "" },
      executionLimits: { maxArrayElements: 2 },
    }).exec("compgen -f a");
    expect(aboveLimit.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(aboveLimit.stderr).toContain(
      "completion element limit exceeded (2)",
    );
  });

  it("shares one glob-operation budget across expanded words", async () => {
    const bash = new Bash({
      files: { "/d/a": "", "/d/b": "" },
      executionLimits: { maxGlobOperations: 3 },
    });
    const result = await bash.exec("echo /d/* /d/*");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("glob_operations work limit exceeded (3)");
  });

  it("charges consumed pipeline intermediates before forwarding them", async () => {
    const produce = defineCommand(
      "produce",
      async () => ({ stdout: "123456789", stderr: "", exitCode: 0 }),
      { trusted: true },
    );
    const bash = new Bash({
      customCommands: [produce],
      executionLimits: { maxOutputSize: 8 },
    });
    const result = await bash.exec("produce | wc -c");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("pipeline: total output size exceeded");
  });

  it("does not mutate frozen empty results while accounting pipelines", async () => {
    const result = await new Bash().exec(": | :");
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("bounds ls output during collection", async () => {
    const bash = new Bash({
      files: { "/long-filename": "" },
      executionLimits: { maxOutputSize: 8 },
    });
    const result = await bash.exec("ls /");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("ls: output size limit exceeded (8 bytes)");
  });

  it("fails brace accumulation prospectively instead of returning a prefix", async () => {
    const bash = new Bash({
      executionLimits: { maxBraceExpansionResults: 2 },
    });
    const result = await bash.exec("printf '%s\\n' {a,b,c}");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("brace expansion");
  });

  it("turns nested test expressions into a controlled depth failure", async () => {
    const bash = new Bash({ executionLimits: { maxCallDepth: 3 } });
    const result = await bash.exec("test ! ! ! ! value");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "test expression: maximum depth (3) exceeded",
    );
  });

  it("preflights dynamically supplied extglob nesting", async () => {
    const bash = new Bash({ executionLimits: { maxCallDepth: 2 } });
    const result = await bash.exec("compgen -X '@(@(@(x)))' -A keyword");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("extglob maximum depth (2) exceeded");
  });

  it("charges shortest suffix removal linearly", async () => {
    const bash = new Bash({ executionLimits: { maxGlobOperations: 4 } });
    const result = await bash.exec('value=aaaaa; echo "${value%z}"');

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("pattern-removal work limit exceeded (4)");
  });

  it("keeps realistic multi-kilobyte suffix removal compatible", async () => {
    const value = "a".repeat(5_000);
    const result = await new Bash().exec(`value=${value}; echo "\${value%a}"`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${"a".repeat(4_999)}\n`);
  });

  it("bounds variable-listing output before joining it", async () => {
    const bash = new Bash({
      env: { LONG_VALUE: "1234567890" },
      executionLimits: { maxOutputSize: 8 },
    });
    const result = await bash.exec("set");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "set: output size limit exceeded (8 bytes)",
    );
  });

  it("preserves quoted set output exactly at the aggregate byte limit", async () => {
    const env = { QUOTED: "a'b" };
    const baseline = await new Bash({ env }).exec("set");
    expect(baseline.exitCode).toBe(0);
    expect(baseline.stdout).toContain("QUOTED='a'\\''b'\n");
    const bytes = utf8ByteLength(baseline.stdout);

    const atLimit = await new Bash({
      env,
      executionLimits: { maxOutputSize: bytes },
    }).exec("set");
    expect(atLimit).toEqual(baseline);

    const aboveLimit = await new Bash({
      env,
      executionLimits: { maxOutputSize: bytes - 1 },
    }).exec("set");
    expect(aboveLimit.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(aboveLimit.stderr).toContain(
      `set: output size limit exceeded (${bytes - 1} bytes)`,
    );
  });
});
