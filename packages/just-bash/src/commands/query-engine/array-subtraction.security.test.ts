import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluator.js";
import { parse } from "./parser.js";
import { sanitizeParsedData } from "./safe-object.js";

describe("query array subtraction safety", () => {
  it("does not mutate either operand", () => {
    const input = sanitizeParsedData({
      left: [{ a: 1, b: 2 }],
      right: [{ b: 2, a: 1 }],
    });
    expect(evaluate(input, parse(".left -= .right"))).toEqual([
      { left: [], right: [{ b: 2, a: 1 }] },
    ]);
    expect(input).toEqual({ left: [{ a: 1, b: 2 }], right: [{ b: 2, a: 1 }] });
  });

  it("keeps primitive subtraction linear in the number of elements", () => {
    const input = {
      left: Array.from({ length: 1000 }, (_, i) => i),
      right: Array.from({ length: 1000 }, (_, i) => i + 500),
    };
    expect(
      evaluate(sanitizeParsedData(input), parse(".left - .right"), {
        limits: { maxIterations: 5000 },
      }),
    ).toEqual([input.left.slice(0, 500)]);
  });

  it("charges nested comparisons to the work budget", () => {
    const input = sanitizeParsedData({
      left: Array.from({ length: 100 }, (_, i) => ({ x: i })),
      right: [{ x: -1 }],
    });
    expect(() =>
      evaluate(input, parse(".left - .right"), {
        limits: { maxIterations: 30 },
      }),
    ).toThrow(/too many iterations/);
  });

  it("charges object key scans even when the object sizes differ", () => {
    const input = sanitizeParsedData({
      left: [
        Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i])),
      ],
      right: [{}],
    });
    expect(() =>
      evaluate(input, parse(".left - .right"), {
        limits: { maxIterations: 30 },
      }),
    ).toThrow(/too many iterations/);
  });

  it("bounds comparison depth", () => {
    const input = sanitizeParsedData({ left: [[[[[1]]]]], right: [[[[[1]]]]] });
    expect(() =>
      evaluate(input, parse(".left - .right"), { limits: { maxDepth: 3 } }),
    ).toThrow(/query depth limit exceeded/);
  });

  it("bounds cyclic container comparisons without recursive calls", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() =>
      evaluate({ left: [cyclic], right: [cyclic] }, parse(".left - .right"), {
        limits: { maxDepth: 10 },
      }),
    ).toThrow(/query depth limit exceeded/);
  });

  it("bounds result allocation even when the right operand is empty", () => {
    expect(() =>
      evaluate([1, 2, 3, 4], parse(". - []"), {
        limits: { maxArrayElements: 3 },
      }),
    ).toThrow(/query result element limit exceeded/);
  });

  it("compares own properties without reading the prototype chain", () => {
    const keys = [
      "__proto__",
      "constructor",
      "prototype",
      "toString",
      "valueOf",
      "hasOwnProperty",
    ];
    const left = Object.fromEntries(keys.map((key) => [key, 1]));
    const right = Object.fromEntries(
      [...keys].reverse().map((key) => [key, 1]),
    );
    expect(
      evaluate({ left: [left], right: [right] }, parse(".left - .right")),
    ).toEqual([[]]);
    expect(
      evaluate({ left: [left], right: [{}] }, parse(".left - .right")),
    ).toEqual([[left]]);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});
