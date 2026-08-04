import { describe, expect, it } from "vitest";
import type { SimpleCommandNode } from "../ast/types.js";
import { Bash } from "../Bash.js";
import { resolveLimits } from "../limits.js";
import { Parser } from "../parser/parser.js";
import { expandAlias } from "./alias-expansion.js";
import { ExecutionLimitError } from "./errors.js";
import { expandBraceRange } from "./expansion/brace-range.js";

describe("interpreter expansion resource limits", () => {
  it("bounds a trailing-space alias chain iteratively", async () => {
    const bash = new Bash({ executionLimits: { maxCallDepth: 3 } });
    const result = await bash.exec(
      "shopt -s expand_aliases; alias a='echo ' b='echo ' c='echo ' d='echo '; a b c d value",
    );

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("alias expansion depth limit exceeded (3)");
  });

  it("checks the reconstructed alias command before parsing it", () => {
    const ast = new Parser().parse("a 123456 123456");
    const node = ast.statements[0].pipelines[0]
      .commands[0] as SimpleCommandNode;

    expect(() =>
      expandAlias(
        {
          env: new Map([["BASH_ALIAS_a", "echo"]]),
          limits: resolveLimits({ maxStringLength: 12 }),
        },
        node,
        new Set(),
      ),
    ).toThrow("alias expansion exceeds string length limit");
  });

  it("enforces aggregate array-assignment elements", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 5 } });
    const result = await bash.exec("f() { local values=(a b c d e f); }; f");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "array assignment element limit exceeded (5)",
    );
  });

  it("bounds the final reconstructed array assignment", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 20 } });
    const result = await bash.exec(
      "f() { local values=('abcdefgh' 'ijklmnop'); }; f",
    );

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("array assignment string limit exceeded");
  });

  it("stops range generation at the configured result limit", () => {
    const result = expandBraceRange(1, 10_000, undefined, "1", "10000", {
      maxResults: 3,
      maxStringBytes: 64,
    });

    expect(result.expanded).toEqual(["1", "2", "3"]);
  });

  it("rejects attacker-controlled range padding before padStart", () => {
    expect(() =>
      expandBraceRange(1, 2, undefined, `0${"0".repeat(64)}1`, "2", {
        maxResults: 10,
        maxStringBytes: 32,
      }),
    ).toThrow("brace expansion padding limit exceeded (32 bytes)");
  });

  it("bounds aggregate vectorized positional replacement output", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 40 } });
    const result = await bash.exec('set -- aaaa aaaa; echo "${@//a/xxxxxxxx}"');

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "positional expansion string limit exceeded",
    );
  });

  it("charges vectorized shortest-pattern-removal work", async () => {
    const bash = new Bash({ executionLimits: { maxGlobOperations: 16 } });
    const result = await bash.exec(
      'set -- aaaaa bbbbb ccccc ddddd; echo "${@%z}"',
    );

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("pattern-removal work limit exceeded (16)");
  });

  it("bounds prompt amplification before constructing the scalar result", async () => {
    const bash = new Bash({
      env: { USER: "abcdefgh" },
      executionLimits: { maxStringLength: 12 },
    });
    const result = await bash.exec('value="\\u\\u"; echo "${value@P}"');

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "prompt expansion exceeds string length limit",
    );
  });

  it("accounts prompt transforms across all array elements", async () => {
    const bash = new Bash({
      env: { USER: "abcdefgh" },
      executionLimits: { maxStringLength: 24 },
    });
    const result = await bash.exec(
      'values=("\\u\\u" "\\u\\u"); echo "${values[@]@P}"',
    );

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("array transform string limit exceeded");
  });
});
