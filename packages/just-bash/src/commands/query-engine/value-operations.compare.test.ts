import { describe, expect, it } from "vitest";
import {
  compareJq,
  compareJqSort,
  compareStrings,
} from "./value-operations.js";

describe("compareStrings", () => {
  it("short-circuits identical strings without charging", () => {
    const long = "x".repeat(100_000);
    let charged = 0;
    expect(
      compareStrings(long, long, (n) => {
        charged += n;
      }),
    ).toBe(0);
    expect(charged).toBe(0);
  });

  it("reports the code points examined for a long shared prefix", () => {
    const prefix = "x".repeat(5000);
    const a = `${prefix}a`;
    const b = `${prefix}b`;
    let charged = 0;
    expect(
      compareStrings(a, b, (n) => {
        charged += n;
      }),
    ).toBeLessThan(0);
    // 5000 shared code points plus the differing one.
    expect(charged).toBe(5001);
  });

  it("charges nothing for a difference at the first code point", () => {
    let charged = 0;
    expect(
      compareStrings("a", "b", (n) => {
        charged += n;
      }),
    ).toBeLessThan(0);
    expect(charged).toBe(1);
  });
});

describe("compareJq NaN ordering (jq 1.7)", () => {
  it("orders NaN below every number, including NaN itself", () => {
    expect(compareJq(Number.NaN, 1)).toBe(-1);
    expect(compareJq(1, Number.NaN)).toBe(1);
    expect(compareJq(Number.NaN, Number.NaN)).toBe(-1);
    expect(compareJq(Number.NaN, Number.POSITIVE_INFINITY)).toBe(-1);
  });

  it("reports NaN-led arrays as less in both directions (jq's <)", () => {
    // jq: [nan,2] < [nan,1] and [nan,1] < [nan,2] are both true.
    expect(compareJq([Number.NaN, 2], [Number.NaN, 1])).toBe(-1);
    expect(compareJq([Number.NaN, 1], [Number.NaN, 2])).toBe(-1);
  });

  it("keeps input order for NaN-led arrays under the sorting comparator", () => {
    // jq's sort preserves input order here; the raw comparator cannot do
    // that under V8 (its insertion sort compares later elements against
    // earlier ones), so the sorting comparator reports such pairs equal.
    const input: [number, number][] = [
      [Number.NaN, 2],
      [Number.NaN, 1],
    ];
    expect([...input].sort(compareJqSort)).toEqual(input);
    expect([...input].reverse().sort(compareJqSort)).toEqual(
      [...input].reverse(),
    );
  });

  it("still deduplicates equal infinities", () => {
    expect(compareJq(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(
      0,
    );
    expect(compareJq(Number.NEGATIVE_INFINITY, Number.NaN)).toBe(1);
  });
});
