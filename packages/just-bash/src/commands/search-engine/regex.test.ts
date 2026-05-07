import { describe, expect, it } from "vitest";
import { buildRegex } from "./regex.js";

/**
 * Direct tests for the preFilter extractor inside buildRegex.
 *
 * The extractor is the safety-critical part of the perf/grep optimisation:
 * a false-positive needle (extracting a literal that isn't actually required
 * by the regex) causes searchContent to skip lines the regex would have
 * matched — a silent correctness bug. These tests cover the happy paths
 * (extraction must succeed) and the safety paths (extraction must return
 * `undefined`, falling back to the unfiltered regex scan).
 */

describe("buildRegex preFilter — happy path", () => {
  it("extracts bare literal in basic mode", () => {
    expect(buildRegex("interface", { mode: "basic" }).preFilter).toEqual({
      needles: ["interface"],
      ignoreCase: false,
    });
  });

  it("strips -w wrapper for single literal", () => {
    expect(
      buildRegex("type", { mode: "basic", wholeWord: true }).preFilter,
    ).toEqual({ needles: ["type"], ignoreCase: false });
  });

  it("strips -w wrapper around alternation", () => {
    expect(
      buildRegex("foo|bar", { mode: "extended", wholeWord: true }).preFilter,
    ).toEqual({ needles: ["foo", "bar"], ignoreCase: false });
  });

  it("splits top-level alternation in extended mode", () => {
    expect(
      buildRegex("interface|type", { mode: "extended" }).preFilter,
    ).toEqual({ needles: ["interface", "type"], ignoreCase: false });
  });

  it("lowercases needles when -i is set", () => {
    expect(
      buildRegex("Async", { mode: "basic", ignoreCase: true }).preFilter,
    ).toEqual({ needles: ["async"], ignoreCase: true });
  });

  it("treats -F fixed strings as literal needles", () => {
    // < and > are not regex meta, so -F leaves them untouched
    expect(buildRegex("Promise<T>", { mode: "fixed" }).preFilter).toEqual({
      needles: ["Promise<T>"],
      ignoreCase: false,
    });
  });

  it("decodes regex meta escaped by -F back to literal text", () => {
    // -F escapes "." to "\\." inside the regex. The needle should be ".", not "\\."
    expect(buildRegex("a.b", { mode: "fixed" }).preFilter).toEqual({
      needles: ["a.b"],
      ignoreCase: false,
    });
  });

  it("decodes \\n / \\t / \\r escapes to their literal characters", () => {
    expect(buildRegex("foo\\nbar", { mode: "extended" }).preFilter).toEqual({
      needles: ["foo\nbar"],
      ignoreCase: false,
    });
  });
});

describe("buildRegex preFilter — safety (must NOT extract)", () => {
  it("rejects quantifier +", () => {
    expect(buildRegex("a+", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects quantifier *", () => {
    expect(buildRegex("a*", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects quantifier ?", () => {
    expect(buildRegex("a?", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects quantifier {n,m}", () => {
    expect(
      buildRegex("a{2,4}", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("rejects character class", () => {
    expect(buildRegex("[abc]", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects start anchor ^", () => {
    expect(buildRegex("^foo", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects end anchor $", () => {
    expect(buildRegex("foo$", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects . (matches any char)", () => {
    // basic mode: . is the dot meta in BRE, not escaped
    expect(buildRegex("a.b", { mode: "basic" }).preFilter).toBeUndefined();
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

  it("rejects bare \\b word boundary", () => {
    // Distinct from the -w wrapper case: \b is the *content*, not a frame
    expect(
      buildRegex("\\bfoo", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("rejects capturing group (foo)", () => {
    expect(buildRegex("(foo)", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects non-capturing group (?:foo) without \\b\\b frame", () => {
    expect(
      buildRegex("(?:foo)", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("rejects alternation when one branch contains meta", () => {
    // "foo" alone would be safe, but "bar+" disqualifies the whole alternation
    // (any matching line might satisfy "bar+" without containing "foo" or "bar")
    expect(
      buildRegex("foo|bar+", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("rejects nested alternation inside a capturing group", () => {
    expect(
      buildRegex("foo(bar|baz)", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("rejects \\x hex escape (would produce wrong needle, e.g. 'x41' for \\x41)", () => {
    expect(buildRegex("\\x41", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("rejects \\u unicode escape (would produce wrong needle, e.g. 'u2764' for \\u2764)", () => {
    expect(
      buildRegex("\\u2764", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });
});

describe("buildRegex preFilter — structural correctness", () => {
  it("does not split | inside non-capturing group", () => {
    // (?:a|b)c has no top-level alternation; it must NOT be split into ["(?:a", "b)c"]
    // Pattern is rejected (group is meta), but the failure mode we're guarding
    // against here is misclassification, not rejection.
    expect(
      buildRegex("(?:a|b)c", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("does not split | inside character class", () => {
    expect(buildRegex("[a|b]", { mode: "extended" }).preFilter).toBeUndefined();
  });

  it("preserves needle ordering for alternation", () => {
    expect(
      buildRegex("alpha|beta|gamma", { mode: "extended" }).preFilter,
    ).toEqual({ needles: ["alpha", "beta", "gamma"], ignoreCase: false });
  });

  it("does not over-strip when pattern just starts with \\b", () => {
    // "\bfoo" (no closing \b) should NOT be treated as a -w wrap
    expect(
      buildRegex("\\bfoo", { mode: "extended" }).preFilter,
    ).toBeUndefined();
  });

  it("returns undefined for empty pattern", () => {
    expect(buildRegex("", { mode: "extended" }).preFilter).toBeUndefined();
  });
});
