import { describe, expect, it } from "vitest";
import { createUserRegex, type UserRegex } from "./user-regex.js";

/**
 * The compiled RE2JS is shared between UserRegex instances built from the same
 * (pattern, flags). Reading it lets these tests assert that sharing happens (or
 * deliberately does not) rather than only asserting it stays correct.
 */
function compiledOf(regex: UserRegex): unknown {
  return (regex as unknown as { _re2: unknown })._re2;
}

describe("compiled pattern cache", () => {
  it("shares one compiled pattern between identical constructions", () => {
    const first = createUserRegex("(escalat|urgent)", "i");
    const second = createUserRegex("(escalat|urgent)", "i");
    expect(compiledOf(second)).toBe(compiledOf(first));
    expect(first.test("URGENT delivery")).toBe(true);
    expect(second.test("URGENT delivery")).toBe(true);
  });

  it("does not share across flags that change matching", () => {
    const insensitive = createUserRegex("abc", "i");
    const sensitive = createUserRegex("abc", "");
    expect(compiledOf(sensitive)).not.toBe(compiledOf(insensitive));
    expect(insensitive.test("ABC")).toBe(true);
    expect(sensitive.test("ABC")).toBe(false);
  });

  it("keeps m and s distinct from each other and from no flags", () => {
    const plain = createUserRegex("a.b$", "");
    const dotAll = createUserRegex("a.b$", "s");
    const multiline = createUserRegex("a.b$", "m");
    expect(compiledOf(dotAll)).not.toBe(compiledOf(plain));
    expect(compiledOf(multiline)).not.toBe(compiledOf(plain));
    expect(compiledOf(multiline)).not.toBe(compiledOf(dotAll));
    expect(plain.test("a\nb")).toBe(false);
    expect(dotAll.test("a\nb")).toBe(true);
  });

  it("shares across flags that only the wrapper interprets", () => {
    // g and d never reach RE2; UserRegex implements them. They must not split
    // the cache, and must still behave independently per instance.
    const global = createUserRegex("a", "g");
    const plain = createUserRegex("a", "");
    expect(compiledOf(global)).toBe(compiledOf(plain));
    expect(global.global).toBe(true);
    expect(plain.global).toBe(false);
    expect(global.match("aaa")).toEqual(["a", "a", "a"]);
    const plainMatch = plain.match("aaa");
    expect(plainMatch?.length).toBe(1);
    expect(plainMatch?.[0]).toBe("a");
  });

  it("keeps lastIndex independent between instances sharing a pattern", () => {
    const first = createUserRegex("a", "g");
    const second = createUserRegex("a", "g");
    expect(compiledOf(second)).toBe(compiledOf(first));
    expect(first.exec("aaa")?.index).toBe(0);
    expect(first.exec("aaa")?.index).toBe(1);
    expect(first.lastIndex).toBe(2);
    expect(second.lastIndex).toBe(0);
    expect(second.exec("aaa")?.index).toBe(0);
  });

  it("keeps result limits per instance, not per compiled pattern", () => {
    const unlimited = createUserRegex("a", "g");
    const limited = createUserRegex("a", "g", { maxResults: 2 });
    expect(compiledOf(limited)).toBe(compiledOf(unlimited));
    expect(unlimited.match("aaaa")).toEqual(["a", "a", "a", "a"]);
    expect(() => limited.match("aaaa")).toThrow(/result limit exceeded \(2\)/);
    // The shared compiled pattern is unaffected by the other instance throwing.
    expect(unlimited.match("aaaa")).toEqual(["a", "a", "a", "a"]);
  });

  it("keeps interleaved matchAll iterators independent", () => {
    const first = createUserRegex("\\d", "g");
    const second = createUserRegex("\\d", "g");
    expect(compiledOf(second)).toBe(compiledOf(first));
    const a = first.matchAll("1 2 3");
    const b = second.matchAll("7 8 9");
    expect(a.next().value?.[0]).toBe("1");
    expect(b.next().value?.[0]).toBe("7");
    expect(a.next().value?.[0]).toBe("2");
    expect(b.next().value?.[0]).toBe("8");
    expect(a.next().value?.[0]).toBe("3");
    expect(b.next().value?.[0]).toBe("9");
    expect(a.next().done).toBe(true);
    expect(b.next().done).toBe(true);
  });

  it("stays correct after the cache evicts an entry", () => {
    const pattern = "evicted-(alpha|beta)";
    const original = createUserRegex(pattern, "i");
    expect(original.test("EVICTED-ALPHA")).toBe(true);

    // The cache holds 256 entries; 300 distinct patterns guarantee eviction.
    for (let i = 0; i < 300; i++) {
      expect(
        createUserRegex(`filler-${i}-(x|y)`, "i").test(`filler-${i}-x`),
      ).toBe(true);
    }

    const rebuilt = createUserRegex(pattern, "i");
    expect(compiledOf(rebuilt)).not.toBe(compiledOf(original));
    expect(rebuilt.test("EVICTED-ALPHA")).toBe(true);
    expect(rebuilt.test("evicted-beta")).toBe(true);
    expect(rebuilt.test("nope")).toBe(false);
    // The pre-eviction instance still holds its own compiled pattern.
    expect(original.test("EVICTED-BETA")).toBe(true);
  });

  it("does not retain patterns longer than 1024 characters", () => {
    const oversized = `${"a".repeat(1025)}|needle`;
    const first = createUserRegex(oversized);
    const second = createUserRegex(oversized);
    expect(compiledOf(second)).not.toBe(compiledOf(first));
    expect(first.test("needle")).toBe(true);
    expect(second.test("needle")).toBe(true);
    expect(second.test("haystack")).toBe(false);
  });

  it("still retains a pattern of exactly 1024 characters", () => {
    const boundary = `${"a".repeat(1017)}|needle`;
    expect(boundary.length).toBe(1024);
    const first = createUserRegex(boundary);
    const second = createUserRegex(boundary);
    expect(compiledOf(second)).toBe(compiledOf(first));
    expect(second.test("needle")).toBe(true);
  });

  it("throws on every construction of an invalid pattern", () => {
    for (let i = 0; i < 3; i++) {
      expect(() => createUserRegex("[")).toThrow(/Invalid regular expression/);
    }
  });

  it("reports lookahead as unsupported on repeat constructions", () => {
    for (let i = 0; i < 3; i++) {
      expect(() => createUserRegex("(?=x)")).toThrow(/Lookahead/);
    }
  });

  it("keeps source and flags reported per instance", () => {
    const global = createUserRegex("shared", "g");
    const plain = createUserRegex("shared", "");
    expect(global.source).toBe("shared");
    expect(plain.source).toBe("shared");
    expect(global.flags).toBe("g");
    expect(plain.flags).toBe("");
  });
});
