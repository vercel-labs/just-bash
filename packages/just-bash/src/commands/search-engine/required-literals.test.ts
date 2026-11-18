import { describe, expect, it } from "vitest";
import { preFilterMatches, requiredLiterals } from "./required-literals.js";

const groups = (pattern: string, ignoreCase = false) =>
  requiredLiterals(pattern, ignoreCase)?.groups ?? null;

describe("requiredLiterals", () => {
  it("requires every literal of a concatenation broken by .*", () => {
    expect(groups("product.*update")).toEqual([["product", "update"]]);
  });

  it("keeps the literals adjacent to a repeated one", () => {
    // ab+c matches abc, abbc, ...: each contains "ab" and "bc".
    expect(groups("ab+c")).toEqual([["ab", "bc"]]);
    expect(groups("abc{2,3}def")).toEqual([["cdef", "abc"]]);
  });

  it("requires nothing of an optional part", () => {
    expect(groups("(foo)?barbaz")).toEqual([["barbaz"]]);
    expect(groups("x{0}y")).toEqual([["y"]]);
    expect(groups("(?:abc)*defgh")).toEqual([["defgh"]]);
  });

  it("distributes nested alternatives over what follows them", () => {
    expect(groups("((a|b)c|d)e")).toEqual([
      ["a", "c", "e"],
      ["b", "c", "e"],
      ["d", "e"],
    ]);
  });

  it("keeps one side of a product that would pass the group limit", () => {
    // 2^7 = 128 alternatives exceed the limit; the last factor alone still holds.
    expect(groups("(a|b)(c|d)(e|f)(g|h)(i|j)(k|l)(m|n)")).toEqual([
      ["m"],
      ["n"],
    ]);
  });

  it("requires nothing of an alternation past the group limit", () => {
    const many = Array.from({ length: 65 }, (_, i) => `word${i}`).join("|");
    expect(groups(many)).toBeNull();
  });

  it("decodes escaped symbols, named groups and surrogate pairs", () => {
    expect(groups("a\\|b")).toEqual([["a|b"]]);
    expect(groups("(?<name>foo)\\.bar")).toEqual([["foo.bar"]]);
    expect(groups("😀x")).toEqual([["😀x"]]);
  });

  it("gives up on constructs whose meaning it does not model", () => {
    for (const pattern of [
      "(?i)foo",
      "foo(?=bar)",
      "foo(?<!bar)",
      "a{x}",
      "a{,3}b",
      "[]a]bc",
      "[^]a]bc",
      "\\x41bc",
      "\\p{L}bc",
      "(foo)\\1",
      "foo)",
      "(foo",
      "[abc",
    ]) {
      expect(requiredLiterals(pattern, false), pattern).toBeNull();
    }
  });

  it("gives up on deep nesting instead of recursing without bound", () => {
    expect(groups(`${"(".repeat(10_000)}a${")".repeat(10_000)}`)).toBeNull();
  });

  it("keeps the ASCII runs of needles under ignoreCase", () => {
    expect(requiredLiterals("Über|FOO", true)).toEqual({
      groups: [["ber"], ["foo"]],
      ignoreCase: true,
    });
    expect(requiredLiterals("σίγμα", true)).toBeNull();
  });

  it("keeps non-ASCII needles when case matters", () => {
    expect(groups("straße")).toEqual([["straße"]]);
  });
});

describe("preFilterMatches", () => {
  it("needs every needle of one group", () => {
    const preFilter = { groups: [["product", "update"]], ignoreCase: false };
    expect(preFilterMatches(preFilter, "update the product")).toBe(true);
    expect(preFilterMatches(preFilter, "product only")).toBe(false);
  });

  it("matches when any group is complete", () => {
    const preFilter = {
      groups: [["alpha"], ["beta", "gamma"]],
      ignoreCase: false,
    };
    expect(preFilterMatches(preFilter, "gamma beta")).toBe(true);
    expect(preFilterMatches(preFilter, "beta delta")).toBe(false);
  });

  it("folds case as RE2 does, including the long s and the Kelvin sign", () => {
    // RE2 matches /sap/i in "ſap" and /kelvin/i in "Kelvin" (U+212A).
    const preFilter = { groups: [["sap"], ["kelvin"]], ignoreCase: true };
    expect(preFilterMatches(preFilter, "ſAP")).toBe(true);
    expect(preFilterMatches(preFilter, "Kelvin")).toBe(true);
    expect(preFilterMatches(preFilter, "SA P")).toBe(false);
  });
});
