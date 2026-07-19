import { describe, expect, it } from "vitest";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { computeAgg } from "./aggregation.js";
import { parseCsv } from "./csv.js";
import { parseMoonblade, parseNamedExpressions } from "./moonblade-parser.js";
import { moonbladeToJq } from "./moonblade-to-jq.js";

describe("xan parser and data resource limits", () => {
  it("rejects malformed tuple aliases instead of looping", () => {
    expect(() => parseNamedExpressions("x as (name;)")).toThrowError(
      "Expected tuple alias, got ;",
    );
  });

  it("bounds Moonblade nesting before recursive parsing", () => {
    const expression = `${"(".repeat(9)}x${")".repeat(9)}`;

    expect(() => parseMoonblade(expression, { maxDepth: 8 })).toThrow(
      ExecutionLimitError,
    );
  });

  it("bounds Moonblade tokens prospectively", () => {
    expect(() =>
      parseMoonblade("a + b + c + d", { maxTokens: 6 }),
    ).toThrowError(/expression token limit exceeded/);
  });

  it("bounds recursive Moonblade-to-jq conversion", () => {
    const ast = parseMoonblade("a + b + c + d + e + f");

    expect(() => moonbladeToJq(ast, true, { maxDepth: 4 })).toThrow(
      ExecutionLimitError,
    );
  });

  it("bounds wide coalesce expansion before constructing its jq AST", () => {
    const ast = parseMoonblade("coalesce(a, b, c, d, e)");

    expect(() => moonbladeToJq(ast, true, { maxAstNodes: 20 })).toThrow(
      ExecutionLimitError,
    );
  });

  it("bounds CSV input before parsing", () => {
    expect(() => parseCsv("a\n12345\n", { maxStringLength: 4 })).toThrow(
      ExecutionLimitError,
    );
  });

  it("bounds aggregate CSV cells independently from rows", () => {
    expect(() =>
      parseCsv("a,b\n1,2\n3,4\n", { maxRows: 10, maxCells: 3 }),
    ).toThrowError(/CSV cell limit exceeded/);
  });

  it("does not mistake wide rows for the row-count limit", () => {
    const parsed = parseCsv("a,b,c,d\n1,2,3,4\n", {
      maxRows: 1,
      maxCells: 4,
    });

    expect(parsed.data).toHaveLength(1);
  });

  it("bounds aggregation string materialization prospectively", () => {
    const data = [{ value: "aaaa" }, { value: "bbbb" }];

    expect(() =>
      computeAgg(
        data,
        { func: "values", expr: "value", alias: "values" },
        {},
        { maxStringLength: 8 },
      ),
    ).toThrowError(/aggregation string limit exceeded/);
  });

  it("computes large min/max inputs without spreading function arguments", () => {
    const data = Array.from({ length: 20_000 }, (_, value) => ({ value }));

    expect(
      computeAgg(
        data,
        { func: "max", expr: "value", alias: "max" },
        {},
        { maxArrayElements: 20_000, maxIterations: 20_000 },
      ),
    ).toBe(19_999);
  });
});
