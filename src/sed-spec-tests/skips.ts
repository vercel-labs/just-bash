/**
 * Skip list for SED spec tests
 *
 * Tests in this list are expected to fail. If a test passes unexpectedly,
 * the test runner will report it as a failure so we know to remove it from the skip list.
 */

/**
 * Files to skip entirely
 */
const SKIP_FILES: Set<string> = new Set<string>([
  // All test files are now enabled
]);

/**
 * Individual test skips within files
 * Format: "fileName:testName" -> skipReason
 */
const SKIP_TESTS: Map<string, string> = new Map<string, string>([
  // BusyBox tests with file handling (- as stdin, multiple files)
  // NOTE: "sed no files (stdin)", "sed explicit stdin", "sed stdin twice", and "sed trailing NUL" now work

  [
    "busybox-sed.tests:sed with N skipping lines past ranges on next cmds",
    "N command with ranges",
  ],

  // NUL byte handling
  // NOTE: "sed embedded NUL" and "sed embedded NUL g" now work
  ["busybox-sed.tests:sed NUL in command", "NUL bytes in command file"],

  // NOTE: "sed backref from empty s uses range regex" now works (trailing newline fix)

  // Various edge cases
  // NOTE: "sed handles empty lines" now works with parser \$ fix
  // NOTE: "sed escaped newline in command" now works with parser multiline fix
  ["busybox-sed.tests:sed subst+write", "w command with multiple files"],
  ["busybox-sed.tests:sed clusternewline", "insert/p command output ordering"],
  // NOTE: "sed match EOF" now works
  // Trailing newline edge case when matches only in first file
  [
    "busybox-sed.tests:sed selective matches noinsert newline",
    "trailing newline with matches only in first file",
  ],
  // $ address with multiple files
  // NOTE: "sed match EOF two files" now works with multi-file handling
  [
    "busybox-sed.tests:sed match EOF inline",
    "$ address with -i and multi-file",
  ],
  ["busybox-sed.tests:sed lie-to-autoconf", "--version output"],
  // NOTE: "sed 2d;2,1p (gnu compat)" now works with backward range fix
  [
    "busybox-sed.tests:sed a cmd ended by double backslash",
    "backslash escaping in a command",
  ],
  // NOTE: "sed special char as s/// delimiter, in pattern" now works
  [
    "busybox-sed.tests:sed special char as s/// delimiter, in replacement 2",
    "special delimiter with backreference",
  ],
  // NOTE: /regex/,+N GNU extension now works (5 tests)

  // PythonSed tests expecting syntax errors
  // NOTE: Tests 8, 9, 10 now work (address-only and incomplete range errors)
  [
    "pythonsed-unit.suite:syntax: terminating commands - aic",
    "#n special comment not supported",
  ],

  // PythonSed #n/#r special comments (GNU extension)
  [
    "pythonsed-unit.suite:regexp address: separators",
    "custom regex delimiter \\x not supported",
  ],
  [
    "pythonsed-unit.suite:regexp address: flags",
    "/I case-insensitive flag not supported",
  ],
  [
    "pythonsed-unit.suite:regexp address: address range with flag",
    "/I case-insensitive flag not supported",
  ],
  [
    "pythonsed-unit.suite:empty addresses: address range",
    "malformed test case: empty input with non-empty expected output",
  ],

  // BRE/ERE regex edge cases
  // NOTE: anchors inside regexp $ and ^ now work
  // NOTE: BRE alternation \|, closing bracket in charset, #n mode now work
  // NOTE: {,n} quantifier syntax now works
  [
    "pythonsed-unit.suite:regexp: back reference before num in address",
    "\\10 backreference in address",
  ],
  [
    "pythonsed-unit.suite:regexp extended: back reference before num in address",
    "\\10 backreference in address with ERE",
  ],
  // NOTE: "regexp: \t \n in char set" now works
  ["pythonsed-unit.suite:avoid python extension - 2", "BRE grouping edge case"],
  ["pythonsed-unit.suite:(^){2}", "#r comment and ^ quantified"],
  [
    "pythonsed-unit.suite:substitution: back reference before num in regexp",
    "\\10 parsed as \\1 + 0",
  ],
  // Multiple quantifier tests expect errors for invalid patterns like ab**
  [
    "pythonsed-unit.suite:regexp: ** BRE (multiple quantifier)",
    "multiple quantifier error handling",
  ],
  [
    "pythonsed-unit.suite:regexp: ** ERE (multiple quantifier)",
    "multiple quantifier error handling",
  ],
  [
    "pythonsed-unit.suite:regexp: *\\\\? BRE (multiple quantifier)",
    "multiple quantifier error handling",
  ],
  [
    "pythonsed-unit.suite:regexp: *? ERE (multiple quantifier)",
    "multiple quantifier error handling",
  ],

  // More BusyBox tests
  ["busybox-sed.tests:sed 's///w FILE'", "w flag with file path syntax"],
  // NOTE: "sed a/i cmd understands \n,\t,\r" tests now work with fixed test file escaping

  // PythonSed chang.suite - complex scripts using N, D, branching
  // NOTE: Many N/D/P tests now pass due to cross-group branching fix
  [
    "pythonsed-chang.suite:Delete two consecutive lines if the first one contains PAT1 and the second one contains PAT2.",
    "N/P/D commands",
  ],
  [
    "pythonsed-chang.suite:Get the line following a line containing PAT - Case 1 - 1.",
    "N/D commands",
  ],
  [
    "pythonsed-chang.suite:Remove comments (/* ... */, maybe multi-line) of a C program. - 1",
    "N command behavior",
  ],
  [
    "pythonsed-chang.suite:Extract (possibly multiline) contents between 'BEGIN' and the matching 'END'.",
    "N command behavior",
  ],
  ["pythonsed-chang.suite:test at line 1516", "** not a valid command"],

  // Tests using #r (ERE mode) with N/D/P commands and complex hold space logic
  [
    "pythonsed-chang.suite:Remove almost identical lines.",
    "N/D/P commands with hold space",
  ],
  [
    'pythonsed-chang.suite:For consecutive "almost identical" lines, print only the first one.',
    "N/D/P commands with hold space",
  ],
  [
    "pythonsed-chang.suite:Remove consecutive duplicate lines.",
    "N/D commands with pattern matching",
  ],
  [
    "pythonsed-chang.suite:Retrieve the first line among consecutive lines of the same key - 1.",
    "N/D commands with complex branching",
  ],

  // More pythonsed-chang.suite tests with complex N/D/branching
  [
    "pythonsed-chang.suite:Delete the LAST N-th line through the LAST M-th line of a datafile, where N is greater than M - 1.",
    "complex N/D branching",
  ],
  [
    "pythonsed-chang.suite:Get every Nth line of a file - 1.",
    "complex N/D branching",
  ],
  [
    "pythonsed-chang.suite:Join every N lines to one - 1.",
    "complex N/D branching",
  ],
  [
    'pythonsed-chang.suite:Extract "Received:" header(s) from a mailbox.',
    "complex N/D branching",
  ],
  [
    "pythonsed-chang.suite:Extract every IMG elements from an HTML file.",
    "complex branching",
  ],
  [
    "pythonsed-chang.suite:Replace odd-numbered and even-numbered double quotes with single quotes and back quotes, respectively.",
    "complex hold space logic",
  ],
  // NOTE: "Remove the start and the end tags..." now works with cross-group branching
  [
    "pythonsed-chang.suite:Find failed instances without latter successful ones.",
    "complex N/D branching",
  ],
  [
    "pythonsed-chang.suite:Change the first quote of every single-quoted string to backquote(`). - 1",
    "complex pattern manipulation",
  ],
  ["pythonsed-chang.suite:1 cat chicken", "test name parsing issue"],
  [
    "pythonsed-chang.suite:First number 1111 Second <2222>",
    "test name parsing issue",
  ],
  ["pythonsed-chang.suite:word_1 word_2 word_3", "test name parsing issue"],
  ["pythonsed-chang.suite:number [8888]", "test name parsing issue"],

  // Multiple quantifier in BRE
  [
    "pythonsed-unit.suite:regexp: *\\? BRE (multiple quantifier)",
    "BRE multiple quantifier handling",
  ],

  // Backreference parsing edge cases
  [
    "pythonsed-unit.suite:substitution: -r: back reference before num in regexp",
    "\\10 parsing with extended regex",
  ],

  // Empty regex with /I flag
  [
    "pythonsed-unit.suite:empty regexp: case modifier propagation",
    "empty regex reuse and /I flag",
  ],
  [
    "pythonsed-unit.suite:empty regexp: same empty regexp, different case status",
    "empty regex reuse and /I flag",
  ],
  [
    "pythonsed-unit.suite:empty regexp: case modifier propagation for addresses",
    "empty regex reuse and /I flag",
  ],
  ["pythonsed-unit.suite:F command", "F command with stdin (no filename)"],

  // NOTE: "substitution: new line in replacement old style" now works
  // Multi-line c command with backslash continuation
  [
    "pythonsed-unit.suite:Change command c",
    "multi-line c command with backslash continuation",
  ],
]);

/**
 * Pattern-based skips for tests matching certain patterns
 * NOTE: Most patterns have been removed as tests are actually passing
 * NOTE: #n and #r special comments actually work in many cases - don't skip by pattern
 */
const SKIP_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // NOTE: Multi-file with stdin marker (input -, - input) now works
  // Skip pythonsed-chang tests with multi-line names (N-th match tests)
  { pattern: /1 cat chicken/, reason: "complex N-th match test" },
  { pattern: /First number 1111/, reason: "complex N-th match test" },
  { pattern: /word_1 word_2/, reason: "complex N-th match test" },
  { pattern: /number \[8888\]/, reason: "complex N-th match test" },
  {
    pattern: /Extract matched headers of a mail/,
    reason: "complex mail header test",
  },
];

/**
 * Get skip reason for a test
 */
export function getSkipReason(
  fileName: string,
  testName: string,
  command?: string,
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

  // Check pattern-based skips against command content
  if (command) {
    for (const { pattern, reason } of SKIP_PATTERNS) {
      if (pattern.test(command)) {
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
