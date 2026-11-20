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
      "echo '[2,1]' | jq -c 'sort_by(range(400000), range(400000), range(400000))'",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("element limit");
  });

  it("caps the total size of a group_by key across all arguments (fixes #736)", async () => {
    const env = new Bash();
    const result = await env.exec(
      "echo '[1]' | jq -c 'group_by(range(600000), range(600000))'",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("element limit");
  });

  it("unique keeps both NaNs, like jq 1.7 (fixes #736)", async () => {
    const env = new Bash();
    // jq never equates NaN with itself, so deduplication keeps both.
    const both = await env.exec(
      "echo null | jq -n '[nan,nan] | unique | length'",
    );
    expect(both.stdout).toBe("2\n");
    const mixed = await env.exec(
      "echo null | jq -n '[nan,1,nan] | unique | length'",
    );
    expect(mixed.stdout).toBe("3\n");
    expect(mixed.exitCode).toBe(0);
  });

  it("unique keeps input order for NaN-led arrays, like jq 1.7 (fixes #736)", async () => {
    const env = new Bash();
    // jq orders NaN below everything including itself, so [nan,2] and
    // [nan,1] compare "less" both ways and a stable sort keeps input order.
    const result = await env.exec(
      "echo null | jq -n -c '[[nan,2],[nan,1]] | unique'",
    );
    expect(result.stdout).toBe("[[null,2],[null,1]]\n");
    expect(result.exitCode).toBe(0);
  });

  it("caps total retained group_by key elements across all items", async () => {
    const env = new Bash({ executionLimits: { maxQueryElements: 1000 } });
    // Each key is 20 elements (under the 1000 cap on its own), but 100
    // items retain 2000 key elements in total.
    const result = await env.exec(
      "echo null | jq -n -c '[range(100)] | group_by(range(20)) | length'",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("element limit");
  });

  it("caps total retained group_by key encoding across all items", async () => {
    const env = new Bash({ executionLimits: { maxStringLength: 500 } });
    // Each key encodes to ~28 chars; 100 of them retain ~2800 chars.
    const result = await env.exec(
      `echo null | jq -n -c '[range(100) | ("x" * 20)] | group_by(.) | length'`,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("key encoding size limit exceeded");
  });

  it("charges long shared-prefix string comparisons to the work budget", async () => {
    const env = new Bash({ executionLimits: { maxJqIterations: 10000 } });
    // 200 strings sharing a 20000-char prefix: ~1600 comparisons walk
    // ~20000 code points each. Uncharged, this sorts fine; charged at
    // one operation per 1024 code points it exhausts the budget.
    const result = await env.exec(
      `echo null | jq -n -c '[range(200) | ("x" * 20000) + "\\(.)"] | sort | length'`,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("too many iterations");
  });
});
