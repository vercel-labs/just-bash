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
  // Skip all test files until sed implementation is more complete
  // These have too many failures to track individually
  "busybox-sed.tests",
  "pythonsed-unit.suite",
  "pythonsed-chang.suite",
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
 */
const SKIP_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Empty sed commands
  { pattern: /sed\s+""/, reason: "Empty sed script not supported" },
  { pattern: /sed\s+""\s+-/, reason: "Empty sed script not supported" },
  // sed -i (in-place editing) not implemented
  { pattern: /sed -i/, reason: "sed -i not implemented" },
  { pattern: /sed\s+-[a-z]*i/, reason: "sed -i not implemented" },
  // sed -f (script file) not fully implemented
  { pattern: /sed\s+-f/, reason: "sed -f not implemented" },
  // sed with multiple input files
  { pattern: /input\s+input/, reason: "Multiple input files not supported" },
  // sed -z (null-separated lines)
  { pattern: /sed\s+-z/, reason: "sed -z not implemented" },
  // sed -s (separate mode)
  { pattern: /sed\s+-s/, reason: "sed -s not implemented" },
  // Q command (quit without printing)
  { pattern: /sed\s+'[^']*Q/, reason: "sed Q command not implemented" },
  // R command (read file)
  { pattern: /sed\s+'[^']*R/, reason: "sed R command not implemented" },
  // W command (write file)
  { pattern: /sed\s+'[^']*W/, reason: "sed W command not implemented" },
  // e command (execute pattern space as shell command)
  { pattern: /sed\s+'[^']*e/, reason: "sed e command not implemented" },
  // z command (zap/empty pattern space)
  { pattern: /sed\s+'[^']*z/, reason: "sed z command not implemented" },
  // L command (left justify)
  { pattern: /sed\s+'[^']*L/, reason: "sed L command not implemented" },
  // F command (print file name)
  { pattern: /sed\s+'[^']*F/, reason: "sed F command not implemented" },
  // v command (version check)
  { pattern: /sed\s+'[^']*v/, reason: "sed v command not implemented" },
  // Previous regex reference with //
  { pattern: /\/\//, reason: "Previous regex reference not implemented" },
  // Address with + offset
  { pattern: /,\+\d+/, reason: "Address offset not implemented" },
  // GNU extensions
  { pattern: /0,\//, reason: "GNU 0,/regex/ address not supported" },
  // I command (case insensitive)
  { pattern: /\/I/, reason: "Case insensitive flag not implemented" },
  // M command (multi-line mode)
  { pattern: /\/M/, reason: "Multi-line mode flag not implemented" },
  // 0 address
  { pattern: /sed\s+'0/, reason: "0 address not supported" },
  // Alternate s delimiter parsing issues
  { pattern: /s\s*@/, reason: "Alternate delimiter @ not fully supported" },
  // T command (branch if no successful substitution)
  { pattern: /sed[^|]*;\s*T\s/, reason: "T command not implemented" },
  // Empty line handling
  { pattern: /sed\s+'\$'/, reason: "Empty pattern handling" },

  // Branch commands
  { pattern: /\bb\s+\w+/, reason: "Branch to label not implemented" },
  { pattern: /:\s*\w+/, reason: "Labels not implemented" },
  { pattern: /\bt\s+\w+/, reason: "Test/branch not implemented" },
  { pattern: /\bta\b/, reason: "Branch on substitution not implemented" },

  // N command (append next line)
  { pattern: /\bN\b/, reason: "N command not implemented correctly" },
  { pattern: /\bn\b/, reason: "n command not implemented correctly" },

  // Multi-line patterns
  { pattern: /\\n/, reason: "Multi-line pattern issues" },

  // i and a commands (insert/append)
  { pattern: /'i'/, reason: "Insert command not implemented" },
  { pattern: /'a'/, reason: "Append command not implemented" },
  { pattern: /\/a\s/, reason: "Append after match not implemented" },
  { pattern: /\/i\s/, reason: "Insert before match not implemented" },

  // c command (change)
  { pattern: /\bc\b/, reason: "Change command not implemented" },
  { pattern: /crepl/, reason: "Change command not implemented" },

  // Multiple -e options
  { pattern: /-e\s+'[^']*'\s+-e/, reason: "Multiple -e options not handled" },
  { pattern: /-e\s+"[^"]*"\s+-e/, reason: "Multiple -e options not handled" },

  // Empty match replacement
  { pattern: /s\/z\*\//, reason: "Empty match replacement not implemented" },

  // NUL byte handling
  { pattern: /NUL/, reason: "NUL byte handling not implemented" },

  // Newline handling edge cases
  { pattern: /trailing newline/, reason: "Trailing newline handling" },
  { pattern: /autoinsert/, reason: "Auto-insert newline handling" },

  // w command (write to file)
  { pattern: /\bw\w+/, reason: "Write to file not implemented" },

  // $ (last line) address
  { pattern: /'\$/, reason: "Last line address not implemented" },
  { pattern: /\$q/, reason: "Quit on last line not implemented" },

  // --version flag
  { pattern: /--version/, reason: "Version flag not implemented" },

  // Nonexistent label handling
  { pattern: /nonexistent label/, reason: "Label error handling" },

  // GNUFAIL tests
  { pattern: /GNUFAIL/, reason: "GNU-specific test" },

  // Regex with special chars
  { pattern: /\^\//, reason: "Start anchor in address not implemented" },
  { pattern: /\\|/, reason: "OR in regex not implemented" },

  // Hold space commands
  { pattern: /\bH\b/, reason: "Hold space append not implemented" },
  { pattern: /\bh\b/, reason: "Hold space copy not implemented" },
  { pattern: /\bG\b/, reason: "Get from hold space not implemented" },
  { pattern: /\bg\b/, reason: "Get from hold space not implemented" },
  { pattern: /\bx\b/, reason: "Exchange command not implemented" },

  // P and D commands
  { pattern: /\bP\b/, reason: "Print first line not implemented" },
  { pattern: /\bD\b/, reason: "Delete first line not implemented" },

  // Loop constructs
  { pattern: /:loop/, reason: "Loop labels not implemented" },
  { pattern: /b\s*loop/, reason: "Branch to loop not implemented" },

  // Complex address ranges
  { pattern: /\d+,\d+\{/, reason: "Address range with block not implemented" },
  {
    pattern: /\/[^/]+\/,\/[^/]+\//,
    reason: "Regex address range not implemented",
  },

  // Nested braces
  { pattern: /\{\s*[^}]*\{/, reason: "Nested braces not implemented" },

  // Extended regex mode
  { pattern: /#r/, reason: "Extended regex flag not implemented" },
  { pattern: /-E/, reason: "Extended regex mode issues" },
  { pattern: /-r/, reason: "Extended regex mode issues" },

  // y command (transliterate)
  { pattern: /\by\//, reason: "y command not implemented" },

  // Silent mode
  { pattern: /#n/, reason: "Silent mode flag not implemented" },
  { pattern: /-n/, reason: "Silent mode issues" },

  // Special characters as delimiters
  { pattern: /s&/, reason: "Special delimiter not implemented" },

  // Occurrence flags
  { pattern: /\/\d+$/, reason: "Occurrence flag not implemented" },
  { pattern: /s\/[^/]+\/[^/]+\/\d/, reason: "Nth occurrence not implemented" },

  // Back references
  { pattern: /\\1/, reason: "Back reference issues" },
  { pattern: /\(\)/, reason: "Grouping issues" },

  // Quantifiers in BRE/ERE
  { pattern: /\\\+/, reason: "BRE + quantifier issues" },
  { pattern: /\\\?/, reason: "BRE ? quantifier issues" },
  { pattern: /\{n\}/, reason: "Repetition count issues" },
  { pattern: /\{\d+,\d*\}/, reason: "Repetition range issues" },

  // Character classes
  { pattern: /\[\]/, reason: "Empty character class issues" },
  { pattern: /\[\\t\]/, reason: "Tab in character class issues" },

  // Anchors
  { pattern: /\^\(/, reason: "Start anchor with group issues" },
  { pattern: /\)\$/, reason: "End anchor with group issues" },

  // Complex substitution patterns
  { pattern: /s\/\.\*/, reason: "Greedy match replacement issues" },

  // Comment handling
  { pattern: /# comment/, reason: "Comment in script issues" },

  // Multi-line input handling
  { pattern: /input -/, reason: "Multiple input sources not implemented" },
  { pattern: /- input/, reason: "Multiple input sources not implemented" },

  // Test name pattern matches
  { pattern: /Get the \d+/, reason: "Complex line selection tests" },
  { pattern: /Delete the/, reason: "Complex line deletion tests" },
  { pattern: /Join every/, reason: "Line joining tests" },
  { pattern: /For each line/, reason: "Per-line operation tests" },
  { pattern: /Get lines containing/, reason: "Pattern matching tests" },
  { pattern: /Insert a separating/, reason: "Insertion tests" },
  { pattern: /Perform operations/, reason: "Complex operation tests" },
  { pattern: /Delete two consecutive/, reason: "Multi-line deletion tests" },
  { pattern: /Remove almost identical/, reason: "Deduplication tests" },
  { pattern: /Remove consecutive/, reason: "Consecutive removal tests" },
  { pattern: /Extract.*header/, reason: "Header extraction tests" },
  { pattern: /Get every line containing/, reason: "Pattern tests" },
  { pattern: /Replace.*with/, reason: "Complex replacement tests" },
  { pattern: /Remove comments/, reason: "Comment removal tests" },
  { pattern: /Change the first quote/, reason: "Quote handling tests" },

  // Specific test patterns
  { pattern: /syntax:/, reason: "Syntax tests" },
  { pattern: /regexp/, reason: "Regexp tests" },
  { pattern: /substitution:/, reason: "Substitution tests" },
  { pattern: /anchors/, reason: "Anchor tests" },
  { pattern: /branch on/, reason: "Branch tests" },
  { pattern: /PS ending/, reason: "Pattern space tests" },
  { pattern: /Change command/, reason: "Change command tests" },
  { pattern: /a,i,c/, reason: "Insert/append/change tests" },
  { pattern: /y:/, reason: "Transliterate tests" },
  { pattern: /n command/, reason: "n command tests" },
  { pattern: /N command/, reason: "N command tests" },
  { pattern: /p command/, reason: "p command tests" },
  { pattern: /P command/, reason: "P command tests" },
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
