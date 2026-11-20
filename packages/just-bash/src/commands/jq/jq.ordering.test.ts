import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Regression tests for the ordering / deduplication semantics behind
 * sort, sort_by, group_by, unique and unique_by (see #736): jq compares
 * strings by code point, treats Infinity and NaN as ordinary ordered
 * numbers, and never merges values that are not actually equal.
 */
describe("jq ordering and deduplication", () => {
  it("sorts strings by code point, not locale (fixes #736)", async () => {
    const env = new Bash();
    const result = await env.exec("echo '[\"a\",\"Z\"]' | jq -c 'sort'");
    expect(result.stdout).toBe('["Z","a"]\n');
    expect(result.exitCode).toBe(0);
  });

  it("sort_by orders string keys by code point (fixes #736)", async () => {
    const env = new Bash();
    const result = await env.exec(
      'echo \'[{"s":"a"},{"s":"Z"}]\' | jq -c \'sort_by(.s) | map(.s)\'',
    );
    expect(result.stdout).toBe('["Z","a"]\n');
    expect(result.exitCode).toBe(0);
  });

  it("unique keeps canonically-equivalent but distinct strings (fixes #736)", async () => {
    const env = new Bash();
    // U+00E9 (NFC) vs U+0065 U+0301 (NFD): localeCompare equates them,
    // jq does not.
    const result = await env.exec(
      "printf '[\"\\u00e9\",\"e\\u0301\"]' | jq -c 'unique'",
    );
    expect(result.stdout).toBe('["e\u0301","\u00e9"]\n');
    // (expected order: NFD "e + U+0301" first, then NFC U+00E9)
    expect(result.exitCode).toBe(0);
  });

  it("unique keeps strings differing only by zero-width or soft hyphen (fixes #736)", async () => {
    const env = new Bash();
    const zwsp = await env.exec(
      "printf '[\"a\\u200bb\",\"ab\"]' | jq -c 'unique | length'",
    );
    expect(zwsp.stdout).toBe("2\n");
    const shy = await env.exec(
      "printf '[\"a\\u00adb\",\"ab\"]' | jq -c 'unique | length'",
    );
    expect(shy.stdout).toBe("2\n");
  });

  it("unique deduplicates equal infinities (fixes #736)", async () => {
    const env = new Bash();
    const result = await env.exec(
      "echo '[1e1000, 1e1000]' | jq -c 'unique | length'",
    );
    expect(result.stdout).toBe("1\n");
    const both = await env.exec(
      "echo '[1e1000, -1e1000, 1e1000]' | jq -c 'unique | length'",
    );
    expect(both.stdout).toBe("2\n");
  });

  it("group_by does not merge an infinite key with null (fixes #736)", async () => {
    const env = new Bash();
    const result = await env.exec(
      "echo '[[1e1000],[null]]' | jq -c 'group_by(.) | length'",
    );
    expect(result.stdout).toBe("2\n");
    expect(result.exitCode).toBe(0);
  });

  it("unique_by does not merge an infinite key with null (fixes #736)", async () => {
    const env = new Bash();
    const result = await env.exec(
      "echo '[1e1000, null]' | jq -c 'unique_by(.) | length'",
    );
    expect(result.stdout).toBe("2\n");
    expect(result.exitCode).toBe(0);
  });

  it("caps the total size of a sort key across all arguments (fixes #736)", async () => {
    const env = new Bash();
    // Each range() stays under the element cap (1000000) on its own;
    // the concatenated key must not.
    const result = await env.exec(
      "echo '[2,1]' | jq -c 'sort_by(range(400000); range(400000); range(400000))'",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("element limit");
  });

  it("caps the total size of a group_by key across all arguments (fixes #736)", async () => {
    const env = new Bash();
    const result = await env.exec(
      "echo '[1]' | jq -c 'group_by(range(600000); range(600000))'",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("element limit");
  });
});
