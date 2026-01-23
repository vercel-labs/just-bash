/**
 * Skip list for AWK spec tests
 *
 * Tests in this list are expected to fail. If a test passes unexpectedly,
 * the test runner will report it as a failure so we know to remove it from the skip list.
 *
 * Format: Map<fileName, Map<testName, skipReason>>
 */

const SKIP_FILES: Set<string> = new Set<string>([
  // ========================================
  // PERMANENT SKIPS - Test infrastructure limitations
  // ========================================
  // These test files use patterns that our test parser cannot extract
  // (complex shell constructs, external dependencies, etc.)
  "T.arnold", // Uses tar archive - requires external file
  "T.beebe", // Uses tar archive - requires external file
  "T.chem", // Complex shell script with external dependencies
  "T.close", // Pipe/close handling - requires real I/O
  "T.getline", // Complex getline with external file dependencies
  "T.latin1", // Locale-specific tests - platform dependent
  "T.lilly", // Complex RE tests with external dependencies
  "T.main", // Requires specific input files
  "T.overflow", // Platform-specific overflow tests
  "T.re", // Complex RE generator - shell-dependent
  "T.redir", // File redirection tests - requires real I/O
  "T.recache", // RE cache tests (no parseable tests)
  "T.split", // Complex split tests with shell dependencies
  "T.sub", // Complex sub/gsub tests with shell dependencies
  "T.system", // system() calls - security concern
  "T.utf", // UTF-8 specific tests - locale dependent
  "T.utfre", // UTF-8 RE specific tests - locale dependent
  "T.-f-f", // Multiple -f flags - CLI option, not AWK language
  "T.csv", // CSV mode - extension not in standard AWK
  "T.flags", // Various CLI flags - not AWK language features
  "T.int-expr", // Interval expressions (no parseable tests)

  // ========================================
  // PERMANENT SKIPS - Features not implemented by design
  // ========================================
  "T.nextfile", // nextfile statement not implemented (rarely used)
]);

/**
 * Individual test skips within files
 * Format: "fileName:testName" -> skipReason
 */
const SKIP_TESTS: Map<string, string> = new Map<string, string>([
  // ========================================
  // T.argv - ARGV/ENVIRON not populated from command line
  // ========================================
  [
    "T.argv:T.argv (ARGV[1] + ARGV[2])",
    "ARGV not populated from command-line args",
  ],
  [
    "T.argv:T.argv (ENVIRON[x1] + ENVIRON[x2])",
    "ENVIRON not populated from shell env",
  ],
  ["T.argv:T.argv (argc *)", "ARGC/ARGV iteration not matching real awk"],
  ["T.argv:T.argv delete ARGV[2]", "delete ARGV behavior differs"],
  ["T.argv:test at line 106", "ARGV command-line args not populated"],
  ["T.argv:test at line 118", "ARGV[2] empty behavior differs"],

  // ========================================
  // T.builtin - Various builtin function edge cases
  // ========================================
  [
    "T.builtin:T.builtin (sin/cos)",
    "Test parser truncates multi-line printf args",
  ],
  [
    "T.builtin:T.builtin (toupper/tolower)",
    "Test uses pipe input which isn't fully supported",
  ],
  [
    "T.builtin:T.builtin (toupper/tolower) for utf-8",
    "UTF-8 locale handling not implemented",
  ],

  // ========================================
  // T.clv - Command line variable tests
  // ========================================
  ["T.clv:T.clv (x=5 /dev/null)", "getline from /dev/null edge case"],
  [
    "T.clv:T.clv (x=19)",
    "Printf %c with escape sequence strings (\\b, \\r, \\f)",
  ],
  ["T.clv:T.clv (stdin only)", "getline from stdin not supported"],
  ["T.clv:T.clv (x=3 only)", "getline with variable assignment"],
  ["T.clv:T.clv (x=6 /dev/null)", "getline from /dev/null edge case"],
  ["T.clv:T.clv (x=7 /dev/null)", "getline from /dev/null edge case"],
  ["T.clv:T.clv (_=7A /dev/null)", "getline from /dev/null edge case"],

  // ========================================
  // T.expr - Expression parsing edge cases
  // ========================================
  [
    "T.expr:{ i=1; print ($++$++i) }... case 1",
    "Complex nested field increment: $++$++i",
  ],
  [
    "T.expr:{ i=1; print ($++$++i) }... case 2",
    "Complex nested field increment: $++$++i",
  ],
  [
    "T.expr:{ i=1; print ($++$++i) }... case 3",
    "Complex nested field increment: $++$++i",
  ],

  // Pattern as expression: $1 !$2 (parsed as concatenation)
  ["T.expr:$1 !$2... case 1", "Pattern parsed as concatenation, not logical"],
  ["T.expr:$1 !$2... case 2", "Pattern parsed as concatenation, not logical"],
  ["T.expr:$1 !$2... case 3", "Pattern parsed as concatenation, not logical"],
  ["T.expr:$1 !$2... case 4", "Pattern parsed as concatenation, not logical"],

  // Regex with concatenation
  [
    "T.expr:{ print ($1~/abc/ !$2) }... case 1",
    "Regex match concatenated with negation",
  ],
  [
    "T.expr:{ print ($1~/abc/ !$2) }... case 2",
    "Regex match concatenated with negation",
  ],
  [
    "T.expr:{ print ($1~/abc/ !$2) }... case 3",
    "Regex match concatenated with negation",
  ],
  [
    "T.expr:{ print ($1~/abc/ !$2) }... case 4",
    "Regex match concatenated with negation",
  ],

  // Large float comparison
  [
    "T.expr:{ print ($1 == $2) }... case 14",
    "2e1000 large float comparison (Infinity handling)",
  ],

  // Array field subscript increment
  [
    "T.expr:{ f[1]=1; f[2]=2; print $f[1], $f[1]++, ... case 1",
    "Array subscript as field index with increment",
  ],

  // ========================================
  // T.func - Function edge cases
  // ========================================
  [
    "T.func:T.func (eqn)",
    "Test parser mixes up return test (L147) with eqn test (L157)",
  ],

  // ========================================
  // T.gawk - gawk-specific features
  // ========================================
  [
    "T.gawk:test at line 9",
    "Array reference passing through nested function calls",
  ],
  ["T.gawk:test at line 198", "Test parser truncates multi-line printf args"],
  ["T.gawk:test at line 251", "Function return value edge case"],
  [
    "T.gawk:test at line 293",
    "Test parser mixes expected output from a different test",
  ],
  ["T.gawk:test at line 323", "printf with substr edge case"],

  // ========================================
  // T.misc - Miscellaneous tests with parser issues
  // ========================================
  ["T.misc:1>&2", "Test name extraction issue from shell redirect syntax"],
  ["T.misc:test at line 452", "Incomplete program: {print $"],
  [
    "T.misc:BAD: T.misc END must preserve $0",
    "Printf positional args: %2$s %1$s not implemented",
  ],
  [
    "T.misc:BAD: T.misc hex string cvt",
    "Hex escape sequences in strings differ",
  ],
  [
    "T.misc:BAD: T.misc sub banana error",
    "sub() with 3rd arg should error, we accept it",
  ],
  [
    "T.misc:BAD: T.misc weird escapes in char class",
    "Escape sequences in character classes differ",
  ],
  [
    "T.misc:BAD: T.misc escape sequences in strings mishandled",
    "Invalid octal escape handling: \\888 etc",
  ],
  ["T.misc:test at line 77", "FILENAME assignment edge case"],
  [
    "T.misc:BAD: T.misc (embedded expression)",
    "Function argument modification behavior",
  ],
  [
    "T.misc:BAD: T.misc continuation line number",
    "Record counting with RS edge case",
  ],
  [
    "T.misc:BAD: T.misc null byte",
    "Test parser incorrectly extracts shell pipeline as AWK program",
  ],
]);

/**
 * Pattern-based skips for tests matching certain patterns
 * These are checked if no exact match is found
 */
const SKIP_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Printf positional arguments not implemented
  { pattern: /printf.*%\d+\$/, reason: "Printf positional arguments (%n$)" },
  // Escape sequences in strings - test name has Unicode replacement char
  {
    pattern: /escape sequences in strings mishandled/,
    reason: "Invalid octal escape handling: \\888 etc",
  },
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

  // Check individual test skip (prefix match - test names may include extra program preview)
  for (const [skipKey, reason] of SKIP_TESTS) {
    if (
      skipKey.startsWith(`${fileName}:`) &&
      testName.startsWith(skipKey.slice(fileName.length + 1))
    ) {
      return reason;
    }
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
