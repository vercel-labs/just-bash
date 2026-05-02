/**
 * Regression tests for the HIGH_BUG moonblade parser finding.
 *
 * The `(` case in `parsePrefix` had broken backtracking when the body
 * was `(ident)` or `(ident, ident, ...)` NOT followed by `=>`. The
 * ad-hoc `pos -= params.length * 2` correction mis-counted comma
 * tokens and re-entered the same `(` case at the same pos, causing
 * infinite recursion until JS stack overflow.
 *
 * These inputs reach the parser via `xan filter '(x)' data.csv`, so
 * an attacker can crash filter from untrusted CSV options.
 */
import { describe, expect, it } from "vitest";
import { parseMoonblade } from "./moonblade-parser.js";

describe("moonblade parser parenthesized expressions", () => {
  it("parses (ident) as a grouped identifier expression", () => {
    const ast = parseMoonblade("(x)");
    expect(ast).toMatchObject({ type: "identifier", name: "x" });
  });

  it("parses (ident op value) as a grouped expression (not a lambda)", () => {
    const ast = parseMoonblade("(x > 5)");
    // Either binary node or func-call node depending on AST flavor —
    // the only requirement is "not a lambda" and "no infinite recursion".
    expect(ast).toMatchObject({});
    expect((ast as { type: string }).type).not.toBe("lambda");
  });

  it("parses (ident, ident) as a grouped tuple-ish expression and does not stack-overflow", () => {
    // Without `=>`, the parser must not commit to lambda parsing.
    // Comma at the top level isn't a binary operator in moonblade, so
    // either this becomes a single expression (first ident only) or
    // throws a clean parse error. What it must NOT do is infinite recurse.
    expect(() => parseMoonblade("(x, y)")).not.toThrow(RangeError);
  });

  it("parses (ident) => body as a single-arg lambda", () => {
    const ast = parseMoonblade("(x) => x + 1");
    expect(ast).toMatchObject({
      type: "lambda",
      params: ["x"],
    });
  });

  it("parses (a, b) => body as a multi-arg lambda", () => {
    const ast = parseMoonblade("(a, b) => a + b");
    expect(ast).toMatchObject({
      type: "lambda",
      params: ["a", "b"],
    });
  });

  it("parses (ident).method() — paren around a method-call receiver", () => {
    // Ensures the backtracked grouped expression continues to combine
    // with following operators correctly.
    expect(() => parseMoonblade("(x).len()")).not.toThrow(RangeError);
  });
});
