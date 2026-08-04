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

  it("counts nested object values against the parser depth budget", () => {
    const nested = `${"{a:".repeat(17)}0${"}".repeat(17)}`;
    expect(() => parse(nested, { maxDepth: 16 })).toThrow(
      "query parse depth limit exceeded (16)",
    );

    const boundary = `${"{a:".repeat(15)}0${"}".repeat(15)}`;
    expect(() => parse(boundary, { maxDepth: 16 })).not.toThrow();
  });

  it("counts recursive try and update grammar paths", () => {
    expect(() => parse(`${"try ".repeat(40)}.`, { maxDepth: 16 })).toThrow(
      "query parse depth limit exceeded (16)",
    );
    expect(() => parse(`${". = ".repeat(40)}.`, { maxDepth: 16 })).toThrow(
      "query parse depth limit exceeded (16)",
    );

    expect(() => parse("try try . catch .", { maxDepth: 16 })).not.toThrow();
    expect(() => parse(".a = .b = 1", { maxDepth: 16 })).not.toThrow();
  });
});
