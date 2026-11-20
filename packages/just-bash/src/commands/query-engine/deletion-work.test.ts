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

  it("deletes nested data under reserved own keys without changing prototypes", () => {
    const json =
      '{"constructor":{"drop":1,"keep":2},"prototype":{"drop":3,"keep":4},"__proto__":{"drop":5,"keep":6},"hasOwnProperty":{"drop":7,"keep":8},"toString":{"drop":9,"keep":10},"valueOf":{"drop":11,"keep":12}}';
    const input = sanitizeParsedData(JSON.parse(json));
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    const [result] = evaluate(
      input,
      parse(
        "del(.constructor.drop,.prototype.drop,.__proto__.drop,.hasOwnProperty.drop,.toString.drop,.valueOf.drop)",
      ),
    );
    expect(result).toEqual(
      JSON.parse(
        '{"constructor":{"keep":2},"prototype":{"keep":4},"__proto__":{"keep":6},"hasOwnProperty":{"keep":8},"toString":{"keep":10},"valueOf":{"keep":12}}',
      ),
    );
    expect(Object.getPrototypeOf(result)).toBe(null);
    for (const value of Object.values(result as Record<string, unknown>)) {
      expect(Object.getPrototypeOf(value)).toBe(null);
    }
    expect(input).toEqual(JSON.parse(json));
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

  it("extracts long static paths without exhausting the call stack or charging reads", () => {
    const expr = parse(`del(${".a".repeat(20_000)})`);
    if (expr.type !== "Call") throw new Error("Expected a del call");
    let component = expr.args[0];
    for (let i = 0; i < 19_000; i++) {
      if (component.type !== "Field" || !component.base) {
        throw new Error("Expected a field chain");
      }
      component = component.base;
    }
    if (component.type !== "Field") throw new Error("Expected a field");
    const name = component.name;
    let reads = 0;
    Object.defineProperty(component, "name", {
      get() {
        reads++;
        return name;
      },
    });
    expect(() =>
      evaluate(null, expr, {
        limits: { maxDepth: 2000, maxIterations: 100 },
      }),
    ).toThrow(ExecutionLimitError);
    expect(reads).toBe(1);

    const pipeline = parse(Array(100).fill(".a").join(" | "));
    expect(
      evaluate(null, pipeline, { limits: { maxIterations: 1000 } }),
    ).toEqual([null]);

    const deepPipePath = parse(`.a | (${".a".repeat(20_000)} | .)`);
    expect(() =>
      evaluate(null, deepPipePath, {
        limits: { maxDepth: 2000, maxIterations: 100 },
      }),
    ).toThrow(ExecutionLimitError);
  });

  it("enforces the depth limit for long elif chains", () => {
    const expr = parse(
      `del(if false then . ${"elif false then . ".repeat(30)}else . end)`,
    );
    expect(() => evaluate(null, expr, { limits: { maxDepth: 16 } })).toThrow(
      ExecutionLimitError,
    );
    expect(evaluate(null, expr, { limits: { maxDepth: 31 } })).toEqual([null]);
    expect(evaluate(null, expr, { limits: { maxDepth: 64 } })).toEqual([null]);
  });
});
