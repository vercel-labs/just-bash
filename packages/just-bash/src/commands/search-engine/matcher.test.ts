import { describe, expect, it } from "vitest";
import { searchContent } from "./matcher.js";
import { buildRegex, type PreFilter } from "./regex.js";

describe("preFilterMatches — substring fast-path", () => {
  it("skips lines where no needle is present (case-sensitive)", () => {
    const content = "hello world\nfoo bar\nhello foo\n";
    const { regex } = buildRegex("foo", { mode: "basic" });
    const preFilter: PreFilter = { needles: ["foo"], ignoreCase: false };
    const result = searchContent(content, regex, { preFilter });
    expect(result.output).toBe("foo bar\nhello foo\n");
    expect(result.matchCount).toBe(2);
  });

  it("lowercases both needle and line when ignoreCase=true", () => {
    const content = "FOO\nfoo\nbar\n";
    const { regex } = buildRegex("foo", { mode: "basic", ignoreCase: true });
    const preFilter: PreFilter = { needles: ["foo"], ignoreCase: true };
    const result = searchContent(content, regex, { preFilter });
    expect(result.output).toBe("FOO\nfoo\n");
    expect(result.matchCount).toBe(2);
  });

  it("passes a line when any of multiple needles matches (OR logic)", () => {
    const content = "alpha\nbeta\ngamma\ndelta\n";
    const { regex } = buildRegex("alpha\\|delta", { mode: "basic" });
    const preFilter: PreFilter = {
      needles: ["alpha", "delta"],
      ignoreCase: false,
    };
    const result = searchContent(content, regex, { preFilter });
    expect(result.output).toBe("alpha\ndelta\n");
    expect(result.matchCount).toBe(2);
  });

  it("outputs non-needle lines under invertMatch (no unsafe skip)", () => {
    // "bar" and "baz" contain no needle — preFilter sets firstMatch=null → no
    // regex match → with invertMatch those lines ARE output. The fast-path
    // is still correct because a line without the needle provably can't match.
    const content = "foo\nbar\nbaz\n";
    const { regex } = buildRegex("foo", { mode: "basic" });
    const preFilter: PreFilter = { needles: ["foo"], ignoreCase: false };
    const result = searchContent(content, regex, {
      preFilter,
      invertMatch: true,
    });
    expect(result.output).toBe("bar\nbaz\n");
    expect(result.matchCount).toBe(2);
  });

  it("does not apply the fast-path skip when preFilter is absent", () => {
    const content = "alpha\nbeta\n";
    const { regex } = buildRegex("alpha", { mode: "basic" });
    const result = searchContent(content, regex, { preFilter: null });
    expect(result.output).toBe("alpha\n");
    expect(result.matchCount).toBe(1);
  });
});

describe("applyReplacement — replacement token substitution", () => {
  it("substitutes $& with the full match text", () => {
    const { regex } = buildRegex("foo", { mode: "basic" });
    const result = searchContent("foo bar\n", regex, {
      replace: "[$&]",
      onlyMatching: true,
    });
    expect(result.output).toBe("[foo]\n");
  });

  it("substitutes $1 and $2 with numbered capture groups", () => {
    const { regex } = buildRegex("(\\w+)@(\\w+)", { mode: "extended" });
    const result = searchContent("user@host\n", regex, {
      replace: "$2/$1",
      onlyMatching: true,
    });
    expect(result.output).toBe("host/user\n");
  });

  it("substitutes $<name> with named capture groups", () => {
    const { regex } = buildRegex("(?P<user>\\w+)@(?P<host>\\w+)", {
      mode: "perl",
    });
    const result = searchContent("alice@example\n", regex, {
      replace: "$<host>/$<user>",
      onlyMatching: true,
    });
    expect(result.output).toBe("example/alice\n");
  });

  it("uses empty string for a missing capture group reference", () => {
    const { regex } = buildRegex("(foo)(bar)?", { mode: "extended" });
    const result = searchContent("foo\n", regex, {
      replace: "$1-$2",
      onlyMatching: true,
    });
    expect(result.output).toBe("foo-\n");
  });

  it("applies replacement inline on the full matching line", () => {
    const { regex } = buildRegex("world", { mode: "basic" });
    const result = searchContent("hello world\n", regex, {
      replace: "WORLD",
    });
    expect(result.output).toBe("hello WORLD\n");
  });
});

describe("searchContentMultiline — file-level preFilter", () => {
  it("returns empty result immediately when no needle in content", () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const { regex, preFilter } = buildRegex("^def \\|^async def ", {
      mode: "basic",
    });
    const result = searchContent(content, regex, {
      multiline: true,
      preFilter,
    });
    expect(result.matched).toBe(false);
    expect(result.output).toBe("");
  });

  it("finds matches normally when needle present in content", () => {
    const content = "class Foo:\n    pass\ndef bar():\n    pass\n";
    // multiline: true adds the m flag so ^ matches at each line boundary
    const { regex, preFilter } = buildRegex("^def \\|^class ", {
      mode: "basic",
      multiline: true,
    });
    const result = searchContent(content, regex, {
      multiline: true,
      preFilter,
      showLineNumbers: true,
    });
    expect(result.matched).toBe(true);
    expect(result.output).toBe("1:class Foo:\n--\n3:def bar():\n");
  });

  it("does NOT skip when invertMatch=true even if needle absent", () => {
    const content = "hello\nworld\n";
    const { regex, preFilter } = buildRegex("^def ", { mode: "basic" });
    const result = searchContent(content, regex, {
      multiline: true,
      preFilter,
      invertMatch: true,
      showLineNumbers: true,
    });
    // All lines match because none contain "def " at line start
    expect(result.matched).toBe(true);
    expect(result.output).toBe("1:hello\n2:world\n");
  });
});
