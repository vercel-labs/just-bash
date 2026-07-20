import { describe, expect, it } from "vitest";
import { evaluate, parse } from "../index.js";

describe("query date builtin validation", () => {
  it.each([
    "gmtime",
    "todate",
    `strftime("%Y")`,
  ])("rejects non-finite timestamps before %s", (filter) => {
    expect(() => evaluate(Number.POSITIVE_INFINITY, parse(filter))).toThrow(
      "timestamp is outside the supported range",
    );
  });

  it("rejects timestamps outside the Date range", () => {
    expect(() => evaluate(8_640_000_000_001, parse("todate"))).toThrow(
      "timestamp is outside the supported range",
    );
  });

  it("rejects unsupported strptime formats instead of fallback parsing", () => {
    expect(() =>
      evaluate("2024-01-02T03:04:05Z", parse(`strptime("%Y")`)),
    ).toThrow("strptime format is not supported: %Y");
  });

  it("rejects ISO-shaped dates that normalize to another date", () => {
    expect(() =>
      evaluate("2024-02-31T03:04:05Z", parse(`strptime("%Y-%m-%dT%H:%M:%SZ")`)),
    ).toThrow("Cannot parse date");
  });
});
