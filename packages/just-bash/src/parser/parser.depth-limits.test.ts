import { describe, expect, it } from "vitest";
import { Parser, parse } from "./parser.js";
import { MAX_PARSER_DEPTH, ParseException } from "./types.js";

function nestedParameterExpansion(depth: number): string {
  let value = "fallback";
  for (let i = 0; i < depth; i++) value = `\${x:-${value}}`;
  return `echo ${value}`;
}

function nestedCommandSubstitution(depth: number): string {
  let value = "echo leaf";
  for (let i = 0; i < depth; i++) value = `echo $(${value})`;
  return value;
}

function nestedBraceExpansion(depth: number): string {
  let value = "{a,b}";
  for (let i = 0; i < depth; i++) value = `{a,${value}}`;
  return `echo ${value}`;
}

const nestingShapes: Array<[string, (depth: number) => string]> = [
  [
    "arithmetic unary operators",
    (depth) => `echo $(( ${"!".repeat(depth)}1 ))`,
  ],
  [
    "arithmetic groups",
    (depth) => `echo $(( ${"(".repeat(depth)}1${")".repeat(depth)} ))`,
  ],
  [
    "right-associative arithmetic powers",
    (depth) =>
      `echo $(( ${Array.from({ length: depth + 1 }, () => "1").join("**")} ))`,
  ],
  ["conditional negation", (depth) => `[[ ${"! ".repeat(depth)}x ]]`],
  [
    "conditional groups",
    (depth) => `[[ ${"( ".repeat(depth)}x${" )".repeat(depth)} ]]`,
  ],
  ["parameter operations", nestedParameterExpansion],
  ["command substitutions", nestedCommandSubstitution],
  ["brace lists", nestedBraceExpansion],
];

describe("shared parser nesting budget", () => {
  it.each(nestingShapes)("allows ordinary nested %s", (_name, source) => {
    expect(() => parse(source(24))).not.toThrow();
  });

  it.each(
    nestingShapes,
  )("rejects deeply nested %s with a controlled parse error", (_name, source) => {
    expect(() => parse(source(MAX_PARSER_DEPTH + 20))).toThrowError(
      ParseException,
    );
    expect(() => parse(source(MAX_PARSER_DEPTH + 20))).toThrow(
      `Maximum parser nesting depth exceeded (${MAX_PARSER_DEPTH})`,
    );
  });

  it("releases shared depth after an unsuccessful parse", () => {
    const parser = new Parser();
    expect(() =>
      parser.parse(nestedParameterExpansion(MAX_PARSER_DEPTH + 20)),
    ).toThrowError(ParseException);
    expect(() => parser.parse("echo recovered")).not.toThrow();
  });
});
