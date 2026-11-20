import { describe, expect, it } from "vitest";
import { evaluate, parse } from "../index.js";

describe("jq date builtin ISO names", () => {
  it("parses an ISO date with fromdateiso8601, like jq", () => {
    expect(evaluate("2026-05-03T22:28:02Z", parse("fromdateiso8601"))).toEqual([
      1777847282,
    ]);
  });

  it("formats a timestamp with todateiso8601, like jq", () => {
    expect(evaluate(1777847282, parse("todateiso8601"))).toEqual([
      "2026-05-03T22:28:02Z",
    ]);
  });

  it("agrees with the fromdate and todate aliases", () => {
    expect(evaluate("2026-05-03T22:28:02Z", parse("fromdate"))).toEqual(
      evaluate("2026-05-03T22:28:02Z", parse("fromdateiso8601")),
    );
    expect(evaluate(1777847282, parse("todate"))).toEqual(
      evaluate(1777847282, parse("todateiso8601")),
    );
  });

  it("lists both ISO names in builtins", () => {
    const [names] = evaluate(null, parse("builtins")) as [string[]];
    expect(names).toContain("fromdateiso8601/0");
    expect(names).toContain("todateiso8601/0");
  });

  it("keeps the strict input checks under the ISO names", () => {
    expect(() => evaluate(42, parse("fromdateiso8601"))).toThrow(
      "fromdateiso8601 requires a string input",
    );
    expect(() => evaluate("tomorrow", parse("todateiso8601"))).toThrow(
      "todateiso8601 requires a number input",
    );
    expect(() => evaluate("not a date", parse("fromdateiso8601"))).toThrow(
      'date "not a date" does not match format',
    );
    expect(() => evaluate(8_640_000_000_001, parse("todateiso8601"))).toThrow(
      "timestamp is outside the supported range",
    );
  });
});
