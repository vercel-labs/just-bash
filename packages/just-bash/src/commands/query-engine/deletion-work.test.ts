import { describe, expect, it } from "vitest";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { evaluate } from "./evaluator.js";
import { parse } from "./parser.js";
import { sanitizeParsedData } from "./safe-object.js";

describe("bulk deletion work", () => {
  it("charges container copies and deletes siblings within a linear budget", () => {
    const input = Array.from({ length: 1000 }, (_, i) => i);
    expect(() =>
      evaluate(input, parse("del(.[0])"), { limits: { maxIterations: 500 } }),
    ).toThrow(ExecutionLimitError);
    expect(
      evaluate(input, parse("del(.[])"), { limits: { maxIterations: 10_000 } }),
    ).toEqual([[]]);
    expect(input).toHaveLength(1000);
    expect(input[0]).toBe(0);
  });

  it("preserves original indices, untouched children and user keys", () => {
    const input = sanitizeParsedData(
      JSON.parse(
        '{"items":[{"a":1,"b":2},10,{"a":3},30,40,50],"constructor":1,"__proto__":2,"prototype":3,"hasOwnProperty":4,"toString":5,"valueOf":6,"keep":[7]}',
      ),
    ) as Record<string, unknown>;
    const [result] = evaluate(
      input,
      parse(
        "del(.items[0].a,.items[-6].b,.items[1],.items[2],.items[2].a,.items[-1],.items[5],.items[3],.items[9])",
      ),
    );
    expect(result).toEqual({ ...input, items: [{}, 40] });
    expect((result as Record<string, unknown>).keep).toBe(input.keep);
    expect(input.items).toEqual([{ a: 1, b: 2 }, 10, { a: 3 }, 30, 40, 50]);
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
  it("deletes reserved own keys without changing prototypes", () => {
    const input = sanitizeParsedData(
      JSON.parse(
        '{"__proto__":1,"constructor":2,"prototype":3,"hasOwnProperty":4,"toString":5,"valueOf":6}',
      ),
    );
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    const [result] = evaluate(input, parse("del(.[])"));
    expect(result).toEqual({});
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
  });

  it("checks recursive traversal work before reading children", () => {
    const input = Array(100).fill(null);
    let reads = 0;
    Object.defineProperty(input, 0, {
      get() {
        reads++;
        return null;
      },
    });
    expect(() =>
      evaluate(input, parse("del(..)"), { limits: { maxIterations: 20 } }),
    ).toThrow(ExecutionLimitError);
    expect(reads).toBe(0);
  });
});
