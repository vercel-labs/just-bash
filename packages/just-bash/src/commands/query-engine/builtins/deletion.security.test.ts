import { describe, expect, it } from "vitest";
import { ExecutionLimitError } from "../../../interpreter/errors.js";
import { evaluate } from "../evaluator.js";
import { parse } from "../parser.js";
import { sanitizeParsedData } from "../safe-object.js";

describe("query deletion safety", () => {
  it("does not mutate the input or shift indexes before nested deletions", () => {
    const input = sanitizeParsedData({ arr: [{ x: 1 }, { x: 2 }, { x: 3 }] });
    expect(evaluate(input, parse("del(.arr[0], .arr[1].x)"))).toEqual([
      { arr: [{}, { x: 3 }] },
    ]);
    expect(input).toEqual({ arr: [{ x: 1 }, { x: 2 }, { x: 3 }] });
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
  ])("ignores the dangerous path component %s", (key) => {
    const input = sanitizeParsedData({ safe: { keep: 1, remove: 2 } });
    const [result] = evaluate(
      input,
      parse(`del(.["${key}"].polluted, .safe.remove)`),
    );
    expect(result).toEqual({ safe: { keep: 1 } });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(evaluate(result, parse(`.["${key}"]`))).toEqual([null]);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("deletes own properties named after Object.prototype methods", () => {
    const input = sanitizeParsedData({
      toString: 1,
      valueOf: 2,
      hasOwnProperty: 2,
    });
    expect(evaluate(input, parse("del(.[] | select(. == 2))"))).toEqual([
      { toString: 1 },
    ]);
  });

  it.each([
    "path(.arr[])",
    "del(.arr[])",
    "del(.arr[]?)",
  ])("bounds the paths collected by %s", (filter) => {
    expect(() =>
      evaluate(sanitizeParsedData({ arr: [1, 2, 3, 4] }), parse(filter), {
        limits: { maxArrayElements: 3 },
      }),
    ).toThrow(ExecutionLimitError);
  });

  it("charges filtered deletion to the shared work budget", () => {
    expect(() =>
      evaluate(
        sanitizeParsedData({ arr: Array.from({ length: 100 }, (_, i) => i) }),
        parse("del(.arr[] | select(. > 0))"),
        { limits: { maxIterations: 20 } },
      ),
    ).toThrow(/too many iterations/);
  });

  it("bounds deletion path depth", () => {
    expect(() =>
      evaluate(
        sanitizeParsedData({ a: { b: { c: 1 } } }),
        parse("del(.a.b.c)"),
        { limits: { maxDepth: 2 } },
      ),
    ).toThrow(/query depth limit exceeded/);
  });

  it.each([
    '. += "abcdef"',
    ". *= 100",
  ])("keeps binary string limits in %s", (filter) => {
    expect(() =>
      evaluate("abc", parse(filter), {
        limits: { maxStringLength: 5 },
      }),
    ).toThrow(ExecutionLimitError);
  });
});
