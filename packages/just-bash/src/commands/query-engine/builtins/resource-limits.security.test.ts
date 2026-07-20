import { describe, expect, it } from "vitest";
import { ExecutionLimitError } from "../../../interpreter/errors.js";
import { evaluate, type QueryExecutionLimits } from "../evaluator.js";
import { parse } from "../parser.js";
import { sanitizeParsedData } from "../safe-object.js";

const limits = (
  overrides: QueryExecutionLimits = {},
): { limits: QueryExecutionLimits } => ({
  limits: {
    maxIterations: 100,
    maxDepth: 16,
    maxArrayElements: 8,
    maxStringLength: 1_024,
    maxOutputSize: 1_024,
    ...overrides,
  },
});

describe("query builtin prospective resource limits", () => {
  it("allows has on internally-created entry objects", () => {
    const input = sanitizeParsedData({ answer: 42 });
    expect(evaluate(input, parse(`to_entries[] | has("key")`))).toEqual([true]);
  });

  it("bounds flattened map and map_values generator output", () => {
    expect(() =>
      evaluate([1, 2, 3], parse("map(., .)"), limits({ maxArrayElements: 5 })),
    ).toThrow(ExecutionLimitError);
    expect(() =>
      evaluate(
        [1, 2, 3],
        parse("map_values(., .)"),
        limits({ maxArrayElements: 5 }),
      ),
    ).toThrow(ExecutionLimitError);
    expect(() =>
      evaluate([1], parse("map(range(100))"), limits({ maxArrayElements: 5 })),
    ).toThrow(/query result element limit exceeded \(5\)/);
  });

  it("bounds iterative recurse and walk traversal depth", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 10; i++) deep = [deep];
    expect(() =>
      evaluate(deep, parse("recurse"), limits({ maxDepth: 4 })),
    ).toThrow(/query depth limit exceeded/);
    expect(() =>
      evaluate(deep, parse("walk(.)"), limits({ maxDepth: 4 })),
    ).toThrow(/query depth limit exceeded/);
  });

  it("rejects invalid and explosive combinations before generation", () => {
    expect(() =>
      evaluate([1, 2], parse("combinations(infinite)"), limits()),
    ).toThrow(/finite non-negative integer/);
    expect(() =>
      evaluate(
        [1, 2, 3],
        parse("combinations(3)"),
        limits({ maxArrayElements: 20 }),
      ),
    ).toThrow(/combination limit exceeded/);
  });

  it("bounds tostream result and traversal allocation", () => {
    expect(() =>
      evaluate(
        [1, 2, 3, 4],
        parse("tostream"),
        limits({ maxArrayElements: 4 }),
      ),
    ).toThrow(ExecutionLimitError);
  });

  it("validates fromstream and setpath indexes before array growth", () => {
    expect(() =>
      evaluate(
        [[[999], "value"]],
        parse("fromstream(.[] )"),
        limits({ maxArrayElements: 8 }),
      ),
    ).toThrow(/array index limit exceeded/);
    expect(() =>
      evaluate(
        null,
        parse("setpath([999]; 1)"),
        limits({ maxArrayElements: 8 }),
      ),
    ).toThrow(/array index limit exceeded/);
  });

  it("bounds cumulative nested setpath allocation", () => {
    expect(
      evaluate(null, parse("setpath([3]; 1)"), limits({ maxArrayElements: 4 })),
    ).toEqual([[null, null, null, 1]]);
    expect(() =>
      evaluate(
        null,
        parse("setpath([7, 7]; 1)"),
        limits({ maxArrayElements: 8, maxIterations: 100 }),
      ),
    ).toThrow(/cumulative array allocation limit exceeded \(8\)/);
  });

  it("bounds direct and logical evaluator result cardinality", () => {
    expect(() =>
      evaluate([1, 2, 3, 4], parse(".[]"), limits({ maxArrayElements: 3 })),
    ).toThrow(/query result element limit exceeded \(3\)/);
    expect(() =>
      evaluate(
        null,
        parse("(1, 2, 3) and (4, 5, 6)"),
        limits({ maxArrayElements: 8 }),
      ),
    ).toThrow(/query result element limit exceeded \(8\)/);
  });

  it("charges paths traversal to the shared query work budget", () => {
    expect(() =>
      evaluate(
        { a: { b: { c: 1 } } },
        parse("paths"),
        limits({ maxIterations: 3 }),
      ),
    ).toThrow(/too many iterations \(3\)/);
  });

  it("preserves jq's negative-index error for pick(last)", () => {
    expect(() => evaluate([1], parse("pick(last)"), limits())).toThrow(
      "Out of bounds negative array index",
    );
  });

  it.each([
    [`split("")`, "abcdef"],
    [`splits("")`, "abcdef"],
    [`scan("")`, "abcdef"],
    ["explode", "abcdef"],
  ])("bounds %s materialization", (filter, input) => {
    expect(() =>
      evaluate(input, parse(filter), limits({ maxArrayElements: 5 })),
    ).toThrow(ExecutionLimitError);
  });
});
