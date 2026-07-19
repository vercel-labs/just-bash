import { describe, expect, it } from "vitest";
import { parse } from "./parser.js";

describe("query parser limits", () => {
  it("rejects nested expressions at the configured depth", () => {
    const filter = `${"(".repeat(40)}.${")".repeat(40)}`;
    expect(() => parse(filter, { maxDepth: 16 })).toThrow(
      "query parse depth limit exceeded (16)",
    );
  });

  it("handles unary operators iteratively and applies the depth limit", () => {
    expect(() => parse(`${"-".repeat(1_000)}1`, { maxDepth: 32 })).toThrow(
      "query parse depth limit exceeded (32)",
    );
  });

  it("rejects source and token budgets before tokenization", () => {
    expect(() => parse(". | . | .", { maxSourceLength: 4 })).toThrow(
      /source length limit exceeded/,
    );
    expect(() => parse(". | . | .", { maxTokens: 5 })).toThrow(
      /token limit exceeded/,
    );
  });
});
