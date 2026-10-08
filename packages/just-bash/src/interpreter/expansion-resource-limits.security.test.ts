import { describe, expect, it, vi } from "vitest";
import type { SimpleCommandNode } from "../ast/types.js";
import { Bash } from "../Bash.js";
import { resolveLimits } from "../limits.js";
import { Parser } from "../parser/parser.js";
import { expandAlias } from "./alias-expansion.js";
import { ExecutionLimitError } from "./errors.js";
import { expandBraceRange } from "./expansion/brace-range.js";
import { expandWordWithGlob } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

describe("interpreter expansion resource limits", () => {
  it.each([
    "${#a[@]}",
    "${#a[*]}",
    "${a[*]:=fallback}",
  ])("bounds produced strings without joining array metadata (%s)", async (parameter) => {
    const ctx = {
      state: {
        env: new Map(),
        arrays: new Map([
          [
            "a",
            {
              kind: "indexed",
              elements: new Map([
                ["0", "abcdefgh"],
                ["1", "ijklmnop"],
              ]),
            },
          ],
        ]),
        options: { nounset: false },
        shoptOptions: {},
      },
      limits: resolveLimits({ maxStringLength: 12 }),
    } as unknown as InterpreterContext;
    const ast = new Parser().parse(`: "${parameter}"`);
    const command = ast.statements[0].pipelines[0]
      .commands[0] as SimpleCommandNode;
    if (parameter === "${a[*]:=fallback}") {
      await expect(expandWordWithGlob(ctx, command.args[0])).rejects.toThrow(
        "array expansion string limit exceeded (12 bytes)",
      );
    } else {
      expect(await expandWordWithGlob(ctx, command.args[0])).toEqual({
        values: ["2"],
        quoted: true,
      });
    }
  });

  it("preserves a non-BMP IFS separator in assignment defaults", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "IFS='💥:'; defaults=(x y); printf '<%s>\\n' \"${value:=${defaults[*]}}\" \"$value\"",
    );
    expect(result.stdout).toBe("<x💥y>\n<x💥y>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    5, 6,
  ])("accounts for a complete IFS code point at a %i-byte limit", async (maxStringLength) => {
    const env = new Map([["IFS", "💥:"]]);
    const ctx = {
      state: {
        env,
        arrays: new Map([
          [
            "defaults",
            {
              kind: "indexed",
              elements: new Map([
                ["0", "x"],
                ["1", "y"],
              ]),
            },
          ],
        ]),
        options: { nounset: false },
        shoptOptions: {},
      },
      limits: resolveLimits({ maxStringLength }),
    } as unknown as InterpreterContext;
    const ast = new Parser().parse(': "${value:=${defaults[*]}}"');
    const command = ast.statements[0].pipelines[0]
      .commands[0] as SimpleCommandNode;
    if (maxStringLength === 5) {
      await expect(expandWordWithGlob(ctx, command.args[0])).rejects.toThrow(
        "array expansion string limit exceeded (5 bytes)",
      );
      expect(env.has("value")).toBe(false);
    } else {
      expect(await expandWordWithGlob(ctx, command.args[0])).toEqual({
        values: ["x💥y"],
        quoted: true,
      });
      expect(env.get("value")).toBe("x💥y");
    }
  });

  it("rejects oversized array defaults before assigning the target", async () => {
    const env = new Map<string, string>();
    const ctx = {
      state: {
        env,
        arrays: new Map([
          [
            "defaults",
            {
              kind: "indexed",
              elements: new Map([
                ["0", "éé"],
                ["1", "éé"],
                ["2", "éé"],
              ]),
            },
          ],
        ]),
        options: { nounset: false },
        shoptOptions: {},
      },
      limits: resolveLimits({ maxStringLength: 12 }),
    } as unknown as InterpreterContext;
    const ast = new Parser().parse(': "${value:=${defaults[@]}}"');
    const command = ast.statements[0].pipelines[0]
      .commands[0] as SimpleCommandNode;

    await expect(expandWordWithGlob(ctx, command.args[0])).rejects.toThrow(
      "array expansion string limit exceeded (12 bytes)",
    );
    expect(env.has("value")).toBe(false);
  });

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

  it("bounds persistent array growth beneath temporary prefix bindings", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 2 } });
    const result = await bash.exec(
      'a=(10 20); a=(1) a=("$((a[2]=3))") :; echo "${#a[@]}"',
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("array element limit exceeded (2)");
  });

  it("does not scan unrelated arrays for each redirected command", async () => {
    const maxWorkUnits = 30000;
    let scannedEntries = 0;
    const iterate = Map.prototype[Symbol.iterator];
    const scan = vi
      .spyOn(Map.prototype, Symbol.iterator)
      .mockImplementation(function (this: Map<unknown, unknown>) {
        // Count actual bulk traversal, including new Map(array.elements), rather
        // than relying on timing or the implementation's budget counter.
        if (this.size === 10000) scannedEntries += this.size;
        return iterate.call(this);
      });
    try {
      const bash = new Bash({ executionLimits: { maxWorkUnits } });
      const result = await bash.exec(
        'a=({1..10000}); for ((i=0; i<100; i++)); do cat /dev/null >/dev/null; done; echo "${#a[@]}"',
      );
      expect(result.stdout).toBe("10000\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(scannedEntries).toBeLessThanOrEqual(maxWorkUnits);
    } finally {
      scan.mockRestore();
    }
  });

  it("charges affected array snapshots before prefix installation", async () => {
    const bash = new Bash({ executionLimits: { maxWorkUnits: 30000 } });
    const result = await bash.exec(
      "a=({1..10000}); a=(temporary) :; echo reached",
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("prefix array snapshot");
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
