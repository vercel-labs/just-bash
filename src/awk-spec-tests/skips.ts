/**
 * Skip list for AWK spec tests
 *
 * Tests in this list are expected to fail. If a test passes unexpectedly,
 * the test runner will report it as a failure so we know to remove it from the skip list.
 *
 * Format: Map<fileName, Map<testName, skipReason>>
 */

const SKIP_FILES: Set<string> = new Set<string>([
  // Shell test scripts that require full shell execution
  // These use complex shell constructs we can't easily parse
  "T.arnold", // Uses tar archive
  "T.beebe", // Uses tar archive
  "T.chem", // Complex shell script
  "T.close", // Pipe/close handling
  "T.getline", // Complex getline tests
  "T.latin1", // Locale-specific
  "T.lilly", // Complex RE tests
  "T.main", // Requires specific input files
  "T.nextfile", // nextfile not implemented
  "T.overflow", // Platform-specific overflow tests
  "T.re", // Complex RE generator
  "T.redir", // File redirection
  "T.recache", // RE cache tests
  "T.split", // Complex split tests
  "T.sub", // Complex sub/gsub tests
  "T.system", // system() calls
  "T.utf", // UTF-8 specific
  "T.utfre", // UTF-8 RE specific
  "T.-f-f", // Multiple -f flags
  "T.csv", // CSV mode not implemented
  "T.flags", // Various flags
  "T.int-expr", // Large integer handling
]);

/**
 * Individual test skips within files
 * Format: "fileName:testName" -> skipReason
 */
const SKIP_TESTS: Map<string, string> = new Map<string, string>([
  // ====== T.argv skips ======
  // Tests that require ARGV/ENVIRON to be set from command line
  [
    "T.argv:T.argv (ARGV[1] + ARGV[2])",
    "ARGV not populated from command-line args",
  ],
  [
    "T.argv:T.argv (ENVIRON[x1] + ENVIRON[x2])",
    "ENVIRON not populated from shell env",
  ],

  // ====== T.builtin skips ======
  [
    "T.builtin:T.builtin (index/substr)",
    "index() with numeric argument coercion",
  ],
  ["T.builtin:T.builtin (toupper/tolower)", "printf with pipe input"],
  [
    "T.builtin:T.builtin (toupper/tolower) for utf-8",
    "UTF-8 locale handling not implemented",
  ],
  [
    "T.builtin:T.builtin LC_NUMERIC radix (.) handling",
    "Locale numeric handling not implemented",
  ],
  ["T.builtin:T.bad: too many args not caught", "Error message format differs"],

  // ====== T.clv skips ======
  ["T.clv:T.clv (x=5 /dev/null)", "getline from /dev/null"],
  ["T.clv:T.clv (x=19)", "Escape sequences in printf: \\b, \\r, \\f"],

  // ====== T.expr skips ======
  // Empty line NF handling
  ["T.expr:{ print NF }... case 1", "Empty line NF handling"],
  ["T.expr:{ print NF }... case 4", "Tab-only line NF handling"],
  ["T.expr:{ print NF }... case 5", "Tab-separated empty fields"],
  ["T.expr:{ print NF, $NF }... case 1", "Empty line $NF handling"],

  // Complex increment expressions
  ["T.expr:{ i=1; print ($++$++i) }... case 1", "Complex $++$++i expression"],
  ["T.expr:{ i=1; print ($++$++i) }... case 2", "Complex $++$++i expression"],
  ["T.expr:{ i=1; print ($++$++i) }... case 3", "Complex $++$++i expression"],

  // Pattern without print ($1 !$2 prints both fields)
  ["T.expr:$1 !$2... case 1", "Pattern action print format"],
  ["T.expr:$1 !$2... case 2", "Pattern action print format"],
  ["T.expr:$1 !$2... case 3", "Pattern action print format"],
  ["T.expr:$1 !$2... case 4", "Pattern action print format"],

  // Regex with concatenation
  ["T.expr:{ print ($1~/abc/ !$2) }... case 1", "Regex pattern with concat"],
  ["T.expr:{ print ($1~/abc/ !$2) }... case 2", "Regex pattern with concat"],
  ["T.expr:{ print ($1~/abc/ !$2) }... case 3", "Regex pattern with concat"],
  ["T.expr:{ print ($1~/abc/ !$2) }... case 4", "Regex pattern with concat"],

  // Logical with empty string
  ["T.expr:{ print !$1 + $2 }... case 2", "!0 + 3 evaluation"],

  // Large float comparison
  ["T.expr:{ print ($1 == $2) }... case 14", "2e1000 large float comparison"],

  // Printf with * width specifier
  [
    'T.expr:{ printf("a%*sb\\n", $1, $2) }... case 1',
    "Printf * width specifier",
  ],
  [
    'T.expr:{ printf("a%*sb\\n", $1, $2) }... case 2',
    "Printf * width specifier",
  ],
  [
    'T.expr:{ printf("a%*sb\\n", $1, $2) }... case 3',
    "Printf * width specifier",
  ],
  [
    'T.expr:{ printf("a%-*sb\\n", $1, $2) }... case 1',
    "Printf -* width specifier",
  ],
  [
    'T.expr:{ printf("a%-*sb\\n", $1, $2) }... case 2',
    "Printf -* width specifier",
  ],
  [
    'T.expr:{ printf("a%-*sb\\n", $1, $2) }... case 3',
    "Printf -* width specifier",
  ],
  [
    'T.expr:{ printf("a%*.*sb\\n", $1, $2, "hello") }... case 1',
    "Printf *.* width/precision",
  ],
  [
    'T.expr:{ printf("a%*.*sb\\n", $1, $2, "hello") }... case 2',
    "Printf *.* width/precision",
  ],
  [
    'T.expr:{ printf("a%*.*sb\\n", $1, $2, "hello") }... case 3',
    "Printf *.* width/precision",
  ],
  [
    'T.expr:{ printf("a%-*.*sb\\n", $1, $2, "hello") ... case 1',
    "Printf -*.* width/precision",
  ],
  [
    'T.expr:{ printf("a%-*.*sb\\n", $1, $2, "hello") ... case 2',
    "Printf -*.* width/precision",
  ],
  [
    'T.expr:{ printf("a%-*.*sb\\n", $1, $2, "hello") ... case 3',
    "Printf -*.* width/precision",
  ],

  // Printf length modifiers (ld, lld, zd, jd, hd, hhd)
  [
    'T.expr:{ printf("%d %ld %lld %zd %jd %hd %hhd\\n... case 1',
    "Printf length modifiers",
  ],
  [
    'T.expr:{ printf("%d %ld %lld %zd %jd %hd %hhd\\n... case 2',
    "Printf length modifiers",
  ],
  [
    'T.expr:{ printf("%d %ld %lld %zd %jd %hd %hhd\\n... case 3',
    "Printf length modifiers",
  ],
  [
    'T.expr:{ printf("%x %lx %llx %zx %jx %hx %hhx\\n... case 1',
    "Printf hex length modifiers",
  ],
  [
    'T.expr:{ printf("%x %lx %llx %zx %jx %hx %hhx\\n... case 2',
    "Printf hex length modifiers",
  ],
  [
    'T.expr:{ printf("%x %lx %llx %zx %jx %hx %hhx\\n... case 3',
    "Printf hex length modifiers",
  ],

  // Logical operators with empty strings
  ["T.expr:{ print $1 || $2 }... case 3", "Empty string in || evaluation"],
  ["T.expr:{ print $1 && $2 }... case 3", "Empty string in && evaluation"],
  ["T.expr:{ print $1 && $2 }... case 4", "Empty string in && evaluation"],
  ["T.expr:{ print $1 && $2 }... case 5", "Empty string in && evaluation"],

  // Array subscript increment
  [
    "T.expr:{ f[1]=1; f[2]=2; print $f[1], $f[1]++, ... case 1",
    "Array field subscript increment",
  ],

  // ====== T.exprconv skips ======
  ["T.exprconv:test at line 140", "Printf with negative width: %*s with -20"],
  ["T.exprconv:test at line 178", "Printf with .10d precision for integers"],
  ["T.exprconv:test at line 246", "Printf + flag for positive numbers"],

  // ====== T.misc skips ======
  ["T.misc:BAD: T.misc hex string cvt", "Hex escapes in strings: \\x49"],
  ["T.misc:BAD: T.misc oct string cvt", "Octal escapes in strings: \\061"],
  // Tests named "1>&2" - parser extracts wrong name from shell redirect
  ["T.misc:1>&2", "Parser extracted wrong test name from 1>&2 redirect"],
  [
    "T.misc:BAD: T.misc weird chars",
    "Escape sequences: \\f, \\r, \\b, \\v, \\a",
  ],
  ["T.misc:test at line 452", "Incomplete program: {print $"],
  [
    "T.misc:BAD: T.misc END must preserve $0: BEGIN {printf",
    "Printf positional args: %2$s %1$s",
  ],
]);

/**
 * Pattern-based skips for tests matching certain patterns
 * These are checked if no exact match is found
 */
const SKIP_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /printf.*%\*/, reason: "Printf * width specifier" },
  { pattern: /printf.*%\d+\$/, reason: "Printf positional arguments" },
  { pattern: /printf.*%[lzjh]/, reason: "Printf length modifiers" },
  { pattern: /printf.*%\+/, reason: "Printf + flag" },
  { pattern: /printf.*%\.10[dx]/, reason: "Printf precision for integers" },
  { pattern: /\\x[0-9a-fA-F]{2}/, reason: "Hex escape sequences" },
  { pattern: /\\\d{3}/, reason: "Octal escape sequences" },
  { pattern: /\\[frbva]/, reason: "Special escape sequences" },
  { pattern: /\$\+\+\$/, reason: "Complex increment expressions" },
  {
    pattern: /^1>&2$/,
    reason: "Parser extracted wrong test name from 1>&2 redirect",
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
