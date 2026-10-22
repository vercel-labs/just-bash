import { describe, expect, it } from "vitest";
import { buildRegex } from "./regex.js";

/**
 * Direct tests for the preFilter extractor inside buildRegex.
 *
 * The extractor is the safety-critical part of the perf/grep optimisation:
 * a false-positive needle (extracting a literal that isn't actually required
 * by the regex) causes searchContent to skip lines the regex would have
 * matched — a silent correctness bug. These tests cover what each pattern
 * requires, and the patterns that require nothing (extraction must return
 * `undefined`, falling back to the unfiltered regex scan).
 * required-literals.test.ts covers the analysis itself.
 */

describe("buildRegex preFilter — happy path", () => {
  it("extracts bare literal in basic mode", () => {
    expect(buildRegex("interface", { mode: "basic" }).preFilter).toEqual({
      groups: [["interface"]],
      ignoreCase: false,
    });
  });

  it("strips -w wrapper for single literal", () => {
    expect(
      buildRegex("type", { mode: "basic", wholeWord: true }).preFilter,
    ).toEqual({ groups: [["type"]], ignoreCase: false });
  });

  it("strips -w wrapper around alternation", () => {
    expect(
      buildRegex("foo|bar", { mode: "extended", wholeWord: true }).preFilter,
    ).toEqual({ groups: [["foo"], ["bar"]], ignoreCase: false });
  });

  it("splits top-level alternation in extended mode", () => {
    expect(
      buildRegex("interface|type", { mode: "extended" }).preFilter,
    ).toEqual({ groups: [["interface"], ["type"]], ignoreCase: false });
  });

  it("lowercases needles when -i is set", () => {
    expect(
      buildRegex("Async", { mode: "basic", ignoreCase: true }).preFilter,
    ).toEqual({ groups: [["async"]], ignoreCase: true });
  });

  it("treats -F fixed strings as literal needles", () => {
    // < and > are not regex meta, so -F leaves them untouched
    expect(buildRegex("Promise<T>", { mode: "fixed" }).preFilter).toEqual({
      groups: [["Promise<T>"]],
      ignoreCase: false,
    });
  });

  it("decodes regex meta escaped by -F back to literal text", () => {
    // -F escapes "." to "\\." inside the regex. The needle should be ".", not "\\."
    expect(buildRegex("a.b", { mode: "fixed" }).preFilter).toEqual({
      groups: [["a.b"]],
      ignoreCase: false,
    });
  });

  it("decodes \\n / \\t / \\r escapes to their literal characters", () => {
    expect(buildRegex("foo\\nbar", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo\nbar"]],
      ignoreCase: false,
    });
  });

  it("extracts needle from leading-anchored literal ^foo", () => {
    expect(buildRegex("^foo", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"]],
      ignoreCase: false,
    });
  });

  it("extracts needle from trailing-anchored literal foo$", () => {
    expect(buildRegex("foo$", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"]],
      ignoreCase: false,
    });
  });

  it("extracts needle from fully-anchored literal ^foo$", () => {
    expect(buildRegex("^foo$", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"]],
      ignoreCase: false,
    });
  });

  it("extracts needles from anchored alternation ^def |^async def (the issue case)", () => {
    // BRE: \| is alternation. This is the canonical pattern from issue #89.
    expect(
      buildRegex("^def \\|^async def ", { mode: "basic" }).preFilter,
    ).toEqual({ groups: [["def "], ["async def "]], ignoreCase: false });
  });

  it("extracts needles from mixed anchored/unanchored alternation", () => {
    expect(buildRegex("^foo|bar|baz$", { mode: "extended" }).preFilter).toEqual(
      { groups: [["foo"], ["bar"], ["baz"]], ignoreCase: false },
    );
  });

  it("preserves literal $ when escaped (foo\\$ → 'foo$')", () => {
    expect(buildRegex("foo\\$", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo$"]],
      ignoreCase: false,
    });
  });
});

describe("buildRegex preFilter — quantifiers, classes, groups and escapes", () => {
  it("requires the literal of quantifier + once", () => {
    expect(buildRegex("a+", { mode: "extended" }).preFilter).toEqual({
      groups: [["a"]],
      ignoreCase: false,
    });
  });

  it("rejects quantifier *", () => {
    expect(buildRegex("a*", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects quantifier ?", () => {
    expect(buildRegex("a?", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("requires the literal of quantifier {n,m} with n > 0 once", () => {
    expect(buildRegex("a{2,4}", { mode: "extended" }).preFilter).toEqual({
      groups: [["a"]],
      ignoreCase: false,
    });
  });

  it("rejects character class", () => {
    expect(buildRegex("[abc]", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("requires the literals on both sides of . (matches any char)", () => {
    // basic mode: . is the dot meta in BRE, not escaped
    expect(buildRegex("a.b", { mode: "basic" }).preFilter).toEqual({
      groups: [["a", "b"]],
      ignoreCase: false,
    });
  });

  it("rejects \\d (digit class)", () => {
    expect(buildRegex("\\d", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects \\w (word class)", () => {
    expect(buildRegex("\\w+", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects \\s (whitespace class)", () => {
    expect(buildRegex("\\s", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("requires the literal after a bare \\b word boundary", () => {
    // Distinct from the -w wrapper case: \b is the *content*, not a frame
    expect(buildRegex("\\bfoo", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"]],
      ignoreCase: false,
    });
  });

  it("requires the literal inside capturing group (foo)", () => {
    expect(buildRegex("(foo)", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"]],
      ignoreCase: false,
    });
  });

  it("requires the literal inside non-capturing group (?:foo)", () => {
    expect(buildRegex("(?:foo)", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"]],
      ignoreCase: false,
    });
  });

  it("keeps the literal of an alternative that contains meta", () => {
    // every match of "bar+" contains "bar"
    expect(buildRegex("foo|bar+", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"], ["bar"]],
      ignoreCase: false,
    });
  });

  it("combines a nested alternation with the literal before it", () => {
    expect(buildRegex("foo(bar|baz)", { mode: "extended" }).preFilter).toEqual({
      groups: [
        ["foo", "bar"],
        ["foo", "baz"],
      ],
      ignoreCase: false,
    });
  });

  it("rejects \\x hex escape (would produce wrong needle, e.g. 'x41' for \\x41)", () => {
    expect(buildRegex("\\x41", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects \\u unicode escape (would produce wrong needle, e.g. 'u2764' for \\u2764)", () => {
    expect(
      buildRegex("\\u2764", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("rejects bare ^ (anchor-only, no useful needle)", () => {
    expect(buildRegex("^", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects bare $ (anchor-only, no useful needle)", () => {
    expect(buildRegex("$", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects ^$ (line-boundary anchor pair, no needle)", () => {
    expect(buildRegex("^$", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects ^a|$ (one branch has no needle)", () => {
    expect(buildRegex("^a|$", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("requires both sides of a mid-alternative ^, which never matches anyway", () => {
    expect(buildRegex("foo^bar", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo", "bar"]],
      ignoreCase: false,
    });
  });
});

describe("buildRegex preFilter — structural correctness", () => {
  it("does not split | inside non-capturing group", () => {
    // (?:a|b)c has no top-level alternation; it must NOT be split into ["(?:a", "b)c"]
    expect(buildRegex("(?:a|b)c", { mode: "extended" }).preFilter).toEqual({
      groups: [
        ["a", "c"],
        ["b", "c"],
      ],
      ignoreCase: false,
    });
  });

  it("does not split | inside character class", () => {
    expect(buildRegex("[a|b]", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("preserves needle ordering for alternation", () => {
    expect(
      buildRegex("alpha|beta|gamma", { mode: "extended" }).preFilter,
    ).toEqual({ groups: [["alpha"], ["beta"], ["gamma"]], ignoreCase: false });
  });

  it("does not over-strip when pattern just starts with \\b", () => {
    // "\bfoo" (no closing \b) is not a -w wrap, but still requires "foo"
    expect(buildRegex("\\bfoo", { mode: "extended" }).preFilter).toEqual({
      groups: [["foo"]],
      ignoreCase: false,
    });
  });

  it("returns undefined for empty pattern", () => {
    expect(buildRegex("", { mode: "extended" }).preFilter).toBeUndefined();
  });
});
