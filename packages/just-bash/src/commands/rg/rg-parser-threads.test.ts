/**
 * Regression tests for the HIGH_BUG `-j`/`--threads` finding.
 *
 * The compatibility flag was wired with `target: "maxDepth"` and
 * `parse: () => Infinity`, intending to be a no-op. In practice every
 * `-j N` invocation silently overwrote the user's max-depth setting
 * to Infinity — disabling the safe default of 256 and any explicit
 * `--max-depth` set earlier on the command line. With unbounded depth,
 * `walkDirectory` could recurse the full filesystem (only bounded by
 * gitignore), which is a security-adjacent DoS when paths are
 * user-controlled.
 *
 * The fix introduces an `ignored: true` flag on ValueOptDef that
 * consumes the value but does not write to RgOptions.
 */
import { describe, expect, it } from "vitest";
import { createDefaultOptions } from "./rg-options.js";
import { parseArgs } from "./rg-parser.js";

const DEFAULT_MAX_DEPTH = createDefaultOptions().maxDepth;

function expectOk(result: ReturnType<typeof parseArgs>) {
  if (!("options" in result)) {
    throw new Error(`Expected ok parse, got error: ${JSON.stringify(result)}`);
  }
  return result;
}

describe("rg -j/--threads compatibility flag", () => {
  it("does not clobber the default maxDepth", () => {
    const result = expectOk(parseArgs(["-j", "4", "foo"]));
    expect(result.options.maxDepth).toBe(DEFAULT_MAX_DEPTH);
  });

  it("does not clobber an explicit --max-depth set BEFORE -j", () => {
    const result = expectOk(parseArgs(["--max-depth", "1", "-j", "4", "foo"]));
    expect(result.options.maxDepth).toBe(1);
  });

  it("does not clobber an explicit --max-depth set AFTER -j", () => {
    const result = expectOk(parseArgs(["-j", "4", "--max-depth", "2", "foo"]));
    expect(result.options.maxDepth).toBe(2);
  });

  it("--threads behaves like -j (long form)", () => {
    const result = expectOk(parseArgs(["--threads", "8", "foo"]));
    expect(result.options.maxDepth).toBe(DEFAULT_MAX_DEPTH);
  });

  it("combined-form -Iij <n> still does not clobber maxDepth", () => {
    // The bug also reaches via `findValueOptByShort('j')` when -j is
    // bundled into a combined-flag form like `-Iij 4`.
    const result = expectOk(parseArgs(["-Iij", "4", "foo"]));
    expect(result.options.maxDepth).toBe(DEFAULT_MAX_DEPTH);
  });

  it("the default maxDepth is a finite, sane value", () => {
    // Sanity floor: regression test against any future attempt to
    // restore Infinity as the default. The recursion guard at
    // walkDirectory uses `if (depth >= options.maxDepth) return;` —
    // Infinity disables it and opens unbounded traversal.
    expect(Number.isFinite(DEFAULT_MAX_DEPTH)).toBe(true);
    expect(DEFAULT_MAX_DEPTH).toBeGreaterThan(0);
  });
});
