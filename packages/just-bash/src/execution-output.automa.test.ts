// Automa modifications: migrate helper-only regressions from
// utils/upstream/patch-output-order.test.mjs to the actual source and budget.
import { describe, expect, it } from "vitest";
import { ExecutionOutputAccumulator, outputSize } from "./execution-output.js";
import { ExecutionScope } from "./execution-scope.js";
import { ExecutionLimitError } from "./interpreter/errors.js";
import { resolveLimits } from "./limits.js";
import type { ExecResult } from "./types.js";

describe("Automa output segment accounting", () => {
  it("preserves BOM data and its existing three-byte credit when normalizing", () => {
    const scope = new ExecutionScope(resolveLimits({ maxOutputSize: 3 }));
    scope.appendOutput("stdout", "\u00ef\u00bb\u00bf", "producer", 0, "bytes");
    const output = new ExecutionOutputAccumulator(scope, "consumer");
    const original: ExecResult = {
      stdout: "\u00ef\u00bb\u00bf",
      stderr: "",
      exitCode: 0,
      internalOutputSegments: [["stdout", "\u00ef\u00bb\u00bf", "bytes"]],
      internalOutputAccounting: { stdout: 3, stderr: 0 },
    };
    output.appendResult(original, "\uFEFF");
    const result = output.build(0);
    expect(result.stdout).toBe("\uFEFF");
    expect(result.internalOutputSegments).toEqual([
      ["stdout", "\uFEFF", "text"],
    ]);
    expect(result.internalOutputAccounting).toEqual({ stdout: 3, stderr: 0 });
    expect(scope.outputBytesUsed).toBe(3);
    expect(original.internalOutputSegments).toEqual([
      ["stdout", "\u00ef\u00bb\u00bf", "bytes"],
    ]);
    scope.accountResult(result, "relay");
    expect(scope.outputBytesUsed).toBe(3);
  });

  for (const stream of ["stdout", "stderr"] as const) {
    it.each([-1, NaN])(`validates empty ${stream} credit %s`, (credit) => {
      const scope = new ExecutionScope(resolveLimits());
      const output = new ExecutionOutputAccumulator(scope, "consumer");
      expect(() =>
        output.appendResult({
          stdout: "",
          stderr: "",
          exitCode: 0,
          internalOutputSegments: [],
          internalOutputAccounting: { stdout: 0, stderr: 0, [stream]: credit },
        }),
      ).toThrow(`invalid ${stream} accounting`);
      expect(scope.outputBytesUsed).toBe(0);
      expect(scope.failure).toBeInstanceOf(ExecutionLimitError);
      expect(output.build(0).internalOutputSegments).toEqual([]);
    });
  }

  it.each([
    "",
    "é",
  ])("clamps positive stdout credit to actual output %j", (text) => {
    const scope = new ExecutionScope(resolveLimits({ maxOutputSize: 2 }));
    scope.appendOutput("stdout", text, "producer");
    const output = new ExecutionOutputAccumulator(scope, "consumer");
    output.appendResult({
      stdout: text,
      stderr: "",
      exitCode: 0,
      internalOutputSegments: text ? [["stdout", text, "text"]] : [],
      internalOutputAccounting: { stdout: 99, stderr: 0 },
    });
    const size = text ? 2 : 0;
    expect(scope.outputBytesUsed).toBe(size);
    expect(output.build(0)).toMatchObject({
      stdout: text,
      stderr: "",
      internalOutputAccounting: { stdout: size, stderr: 0 },
    });
  });

  it("keeps mixed Unicode text and invalid raw bytes distinct without charging twice", () => {
    const scope = new ExecutionScope(resolveLimits({ maxOutputSize: 3 }));
    scope.appendOutput("stdout", "é", "producer");
    scope.appendOutput("stdout", "ÿ", "producer", 0, "bytes");
    const output = new ExecutionOutputAccumulator(scope, "consumer");
    const original: ExecResult = {
      stdout: "éÿ",
      stderr: "",
      exitCode: 0,
      internalOutputSegments: [
        ["stdout", "é", "text"],
        ["stdout", "ÿ", "bytes"],
      ],
      internalOutputAccounting: { stdout: 3, stderr: 0 },
    };
    output.appendResult(original);
    const result = output.build(0);
    expect(result.internalOutputSegments).toEqual(
      original.internalOutputSegments,
    );
    expect(result.stdout).toBe("éÿ");
    expect(result.stderr).toBe("");
    expect(result.internalOutputAccounting).toEqual({ stdout: 3, stderr: 0 });
    expect(outputSize(result, "stdout")).toBe(3);
    scope.accountResult(result, "relay");
    expect(scope.outputBytesUsed).toBe(3);
  });
});
