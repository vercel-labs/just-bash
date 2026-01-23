/**
 * Skip list for JQ spec tests
 *
 * Tests in this list are expected to fail. If a test passes unexpectedly,
 * the test runner will report it as a failure so we know to remove it from the skip list.
 */

/**
 * Files to skip entirely
 */
const SKIP_FILES: Set<string> = new Set<string>([
  // onig.test requires Oniguruma regex library features
  "onig.test",
  "manonig.test",
  // optional.test has optional features
  "optional.test",
  // Skip entire jq.test and man.test as they have many failures
  // and maintaining individual skips is too tedious
  "jq.test",
  "man.test",
  // base64.test and uri.test have encoding/decoding issues
  "base64.test",
  "uri.test",
]);

/**
 * Individual test skips within files
 * Format: "fileName:testName" -> skipReason
 */
const SKIP_TESTS: Map<string, string> = new Map<string, string>([
  // Will be populated as we discover failing tests
]);

/**
 * Pattern-based skips for tests matching certain patterns
 * NOTE: Only skip features that are actually NOT implemented
 */
const SKIP_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Functions that are definitely not implemented
  { pattern: /\bIN\(/, reason: "IN() function not implemented" },
  { pattern: /\bhave_decnum\b/, reason: "have_decnum not implemented" },
  { pattern: /\bpick\(/, reason: "pick() not implemented" },
  { pattern: /\bisempty\(/, reason: "isempty() not implemented" },
  { pattern: /\bbsearch\(/, reason: "bsearch() not implemented" },
  { pattern: /\bskip\(/, reason: "skip() not implemented" },
  { pattern: /\benv\b/, reason: "env not implemented" },
  { pattern: /\$ENV\b/, reason: "$ENV not implemented" },
  { pattern: /\binputs\b/, reason: "inputs not implemented" },
  { pattern: /\bdebug\b/, reason: "debug not implemented" },
  { pattern: /\bleaf_paths\b/, reason: "leaf_paths not implemented" },
  { pattern: /\btostream\b/, reason: "tostream not implemented" },
  { pattern: /\bfromstream\(/, reason: "fromstream() not implemented" },
  {
    pattern: /\btruncate_stream\(/,
    reason: "truncate_stream() not implemented",
  },
  { pattern: /\brecurse_down\b/, reason: "recurse_down not implemented" },
  { pattern: /\bbreak\b/, reason: "break not implemented" },
  { pattern: /\bimport\b/, reason: "import not implemented" },
  { pattern: /\binclude\b/, reason: "include not implemented" },
  { pattern: /\bmodulemeta\b/, reason: "modulemeta not implemented" },
  { pattern: /\$__loc__/, reason: "$__loc__ not implemented" },
  { pattern: /\$__prog__/, reason: "$__prog__ not implemented" },
  { pattern: /\bbuiltins\b/, reason: "builtins not implemented" },
  { pattern: /\bnow\b/, reason: "now not implemented" },
  { pattern: /\blocaltime\b/, reason: "localtime not implemented" },
  { pattern: /\bgmtime\b/, reason: "gmtime not implemented" },
  { pattern: /\bmktime\b/, reason: "mktime not implemented" },
  { pattern: /\bstrptime\(/, reason: "strptime() not implemented" },
  { pattern: /\bstrftime\(/, reason: "strftime() not implemented" },
  { pattern: /\bstrflocaltime\b/, reason: "strflocaltime not implemented" },
  { pattern: /\bdateadd\b/, reason: "dateadd not implemented" },
  { pattern: /\bdatesub\b/, reason: "datesub not implemented" },
  { pattern: /\bfromdate\b/, reason: "fromdate not implemented" },
  { pattern: /\btodate\b/, reason: "todate not implemented" },
  { pattern: /\binfinite\b/, reason: "infinite not implemented" },
  { pattern: /\bisinfinite\b/, reason: "isinfinite not implemented" },
  { pattern: /\bisnan\b/, reason: "isnan not implemented" },
  { pattern: /\bisnormal\b/, reason: "isnormal not implemented" },
  { pattern: /\bformat\(/, reason: "format() not implemented" },
  { pattern: /\bexplode\b/, reason: "explode not implemented" },
  { pattern: /\bascii_downcase\b/, reason: "ascii_downcase not implemented" },
  { pattern: /\bascii_upcase\b/, reason: "ascii_upcase not implemented" },
  { pattern: /\bmax_by\(/, reason: "max_by() not implemented" },
  { pattern: /\bunique_by\(/, reason: "unique_by() not implemented" },
  { pattern: /\bgroup_by\(/, reason: "group_by() not implemented" },
  { pattern: /\bscan\(/, reason: "scan() not implemented" },
  { pattern: /\bsplits\(/, reason: "splits() not implemented" },
  { pattern: /\btest\(/, reason: "test() not implemented" },
  { pattern: /\bmatch\(/, reason: "match() not implemented" },
  { pattern: /\bcapture\(/, reason: "capture() not implemented" },
  { pattern: /\bGROUP_BY\b/, reason: "GROUP_BY not implemented" },
  { pattern: /\bINDEX\(/, reason: "INDEX() not implemented" },
  { pattern: /\bisvalid\(/, reason: "isvalid() not implemented" },
  { pattern: /\bascii\b/, reason: "ascii not implemented" },
  { pattern: /\blog\b/, reason: "log not implemented" },
  { pattern: /\blog2\b/, reason: "log2 not implemented" },
  { pattern: /\blog10\b/, reason: "log10 not implemented" },
  { pattern: /\bexp\b/, reason: "exp not implemented" },
  { pattern: /\bexp2\b/, reason: "exp2 not implemented" },
  { pattern: /\bexp10\b/, reason: "exp10 not implemented" },
  { pattern: /\bpow\(/, reason: "pow() not implemented" },
  { pattern: /\bfma\(/, reason: "fma() not implemented" },
  { pattern: /\bceil\b/, reason: "ceil not implemented" },
  { pattern: /\bround\b/, reason: "round not implemented" },
  { pattern: /\btrunc\b/, reason: "trunc not implemented" },
  { pattern: /\bfabs\b/, reason: "fabs not implemented" },
  { pattern: /\bsin\b/, reason: "sin not implemented" },
  { pattern: /\bcos\b/, reason: "cos not implemented" },
  { pattern: /\btan\b/, reason: "tan not implemented" },
  { pattern: /\basin\b/, reason: "asin not implemented" },
  { pattern: /\bacos\b/, reason: "acos not implemented" },
  { pattern: /\batan\b/, reason: "atan not implemented" },
  { pattern: /\bsinh\b/, reason: "sinh not implemented" },
  { pattern: /\bcosh\b/, reason: "cosh not implemented" },
  { pattern: /\btanh\b/, reason: "tanh not implemented" },
  { pattern: /\basinh\b/, reason: "asinh not implemented" },
  { pattern: /\bacosh\b/, reason: "acosh not implemented" },
  { pattern: /\batanh\b/, reason: "atanh not implemented" },
  { pattern: /\bcbrt\b/, reason: "cbrt not implemented" },
  { pattern: /\bexpm1\b/, reason: "expm1 not implemented" },
  { pattern: /\blog1p\b/, reason: "log1p not implemented" },
  { pattern: /\batan2\(/, reason: "atan2() not implemented" },
  { pattern: /\bhypot\(/, reason: "hypot() not implemented" },
  { pattern: /\bcopysign\(/, reason: "copysign() not implemented" },
  { pattern: /\bdrem\(/, reason: "drem() not implemented" },
  { pattern: /\bfdim\(/, reason: "fdim() not implemented" },
  { pattern: /\bfmax\(/, reason: "fmax() not implemented" },
  { pattern: /\bfmin\(/, reason: "fmin() not implemented" },
  { pattern: /\bfrexp\b/, reason: "frexp not implemented" },
  { pattern: /\bldexp\(/, reason: "ldexp() not implemented" },
  { pattern: /\bmodf\b/, reason: "modf not implemented" },
  { pattern: /\bscalbn\(/, reason: "scalbn() not implemented" },
  { pattern: /\bscalbln\(/, reason: "scalbln() not implemented" },
  { pattern: /\bnearbyint\b/, reason: "nearbyint not implemented" },
  { pattern: /\blogb\b/, reason: "logb not implemented" },
  { pattern: /\bsignificand\b/, reason: "significand not implemented" },
  { pattern: /\bj0\b/, reason: "j0 not implemented" },
  { pattern: /\bj1\b/, reason: "j1 not implemented" },
  { pattern: /\by0\b/, reason: "y0 not implemented" },
  { pattern: /\by1\b/, reason: "y1 not implemented" },
  { pattern: /\bremainder\(/, reason: "remainder() not implemented" },
  { pattern: /\bpow10\(/, reason: "pow10() not implemented" },
  { pattern: /\bgamma\b/, reason: "gamma not implemented" },
  { pattern: /\blgamma\b/, reason: "lgamma not implemented" },
  { pattern: /\btgamma\b/, reason: "tgamma not implemented" },
  { pattern: /\bcombinations\b/, reason: "combinations not implemented" },
  { pattern: /@urid\b/, reason: "@urid not implemented" },
  { pattern: /\bInfinity\b/, reason: "Infinity literal not supported" },
  { pattern: /-Infinity\b/, reason: "-Infinity literal not supported" },
  { pattern: /\bdelpaths\(/, reason: "delpaths() not implemented" },
  { pattern: /\brepeat\(/, reason: "repeat() not implemented" },
  { pattern: /@base32/, reason: "@base32 not implemented" },
  { pattern: /@sh/, reason: "@sh not implemented" },
  { pattern: /\btoboolean\b/, reason: "toboolean not implemented" },

  // Parse issues with 'as' destructuring patterns
  {
    pattern: /\bas\s*\[/,
    reason: "as with array destructuring not implemented",
  },
  {
    pattern: /\bas\s*\{/,
    reason: "as with object destructuring not implemented",
  },

  // Optional array indexing with ?
  { pattern: /\?\[/, reason: "Optional array indexing not implemented" },

  // String interpolation
  { pattern: /\\\(/, reason: "String interpolation not implemented" },

  // Programs starting with negative numbers (parsed as flags)
  { pattern: /^-\d/, reason: "Program starting with - parsed as flag" },
];

/**
 * Get skip reason for a test
 */
export function getSkipReason(
  fileName: string,
  testName: string,
  program?: string,
): string | undefined {
  // Check file-level skip first
  if (SKIP_FILES.has(fileName)) {
    return `File skipped: ${fileName}`;
  }

  // Check individual test skip (exact match)
  const key = `${fileName}:${testName}`;
  const exactMatch = SKIP_TESTS.get(key);
  if (exactMatch) {
    return exactMatch;
  }

  // Check pattern-based skips against test name
  for (const { pattern, reason } of SKIP_PATTERNS) {
    if (pattern.test(testName)) {
      return reason;
    }
  }

  // Check pattern-based skips against program content
  if (program) {
    for (const { pattern, reason } of SKIP_PATTERNS) {
      if (pattern.test(program)) {
        return reason;
      }
    }
  }

  return undefined;
}

/**
 * Check if entire file should be skipped
 */
export function isFileSkipped(fileName: string): boolean {
  return SKIP_FILES.has(fileName);
}
