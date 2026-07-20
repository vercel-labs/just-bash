import { describe, expect, it } from "vitest";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { AwkParser } from "./parser2.js";

describe("AWK parser resource limits", () => {
  it("rejects excessive delimiter nesting before recursive parsing", () => {
    const parser = new AwkParser({ maxDepth: 8 });
    const nested = `${"(".repeat(9)}1${")".repeat(9)}`;

    expect(() => parser.parse(`BEGIN { print ${nested} }`)).toThrow(
      ExecutionLimitError,
    );
  });

  it("bounds lexer tokens before retaining another token", () => {
    const parser = new AwkParser({ maxTokens: 12 });

    expect(() => parser.parse("BEGIN { print 1, 2, 3, 4, 5, 6 }")).toThrowError(
      /token limit exceeded/,
    );
  });

  it("charges print lookahead against the shared parser work budget", () => {
    const parser = new AwkParser({ maxOperations: 30 });

    expect(() =>
      parser.parse("BEGIN { print a + b + c + d + e ? 1 : 0 }"),
    ).toThrowError(/parser operation limit exceeded/);
  });

  it("consumes repeated continuation newlines without host recursion", () => {
    const parser = new AwkParser({ maxSourceLength: 100_000 });

    expect(() =>
      parser.parse(`BEGIN {${"\n".repeat(20_000)}print 1 }`),
    ).not.toThrow();
  });
});
