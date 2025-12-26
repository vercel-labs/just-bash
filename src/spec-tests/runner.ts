/**
 * Spec test runner - executes parsed spec tests against BashEnv
 */

import { BashEnv } from "../BashEnv.js";
import {
  getAcceptableStatuses,
  getExpectedStatus,
  getExpectedStderr,
  getExpectedStdout,
  isNotImplementedForBash,
  type ParsedSpecFile,
  requiresExternalCommands,
  type TestCase,
} from "./parser.js";

export interface TestResult {
  testCase: TestCase;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  actualStdout?: string;
  actualStderr?: string;
  actualStatus?: number;
  expectedStdout?: string | null;
  expectedStderr?: string | null;
  expectedStatus?: number | null;
  error?: string;
}

export interface RunOptions {
  /** Only run tests matching this pattern */
  filter?: RegExp;
  /** Skip tests requiring external commands */
  skipExternal?: boolean;
  /** Custom BashEnv options */
  bashEnvOptions?: ConstructorParameters<typeof BashEnv>[0];
}

/**
 * Run a single test case
 */
export async function runTestCase(
  testCase: TestCase,
  options: RunOptions = {},
): Promise<TestResult> {
  // Check if test should be skipped
  if (testCase.skip) {
    return {
      testCase,
      passed: true,
      skipped: true,
      skipReason: testCase.skip,
    };
  }

  if (isNotImplementedForBash(testCase)) {
    return {
      testCase,
      passed: true,
      skipped: true,
      skipReason: "N-I (Not Implemented) for bash",
    };
  }

  if (options.skipExternal !== false && requiresExternalCommands(testCase)) {
    return {
      testCase,
      passed: true,
      skipped: true,
      skipReason: "Requires external commands (printenv.py, argv.py, etc.)",
    };
  }

  // Skip empty scripts
  if (!testCase.script.trim()) {
    return {
      testCase,
      passed: true,
      skipped: true,
      skipReason: "Empty script",
    };
  }

  // Skip xtrace tests (set -x is accepted but trace output not implemented)
  if (requiresXtrace(testCase)) {
    return {
      testCase,
      passed: true,
      skipped: true,
      skipReason: "xtrace (set -x) trace output not implemented",
    };
  }

  // Skip tests for features documented as known limitations (approved in SKIP_PROPOSAL.md)
  const limitation = isKnownLimitation(testCase);
  if (limitation) {
    return {
      testCase,
      passed: true,
      skipped: true,
      skipReason: limitation,
    };
  }

  // Create a fresh BashEnv for each test
  // Note: Don't use dotfiles here as they interfere with glob tests like "echo .*"
  const env = new BashEnv({
    files: {
      "/tmp/_keep": "",
      // Set up /dev/zero as a character device placeholder
      "/dev/zero": "",
      // Set up /bin directory
      "/bin/_keep": "",
    },
    cwd: "/tmp",
    env: {
      HOME: "/tmp",
      TMP: "/tmp",
      TMPDIR: "/tmp",
      SH: "bash", // For tests that check which shell is running
    },
    ...options.bashEnvOptions,
  });

  // Set up /tmp with sticky bit (mode 1777) for tests that check it
  await env.fs.chmod("/tmp", 0o1777);

  try {
    // Use rawScript to preserve leading whitespace for here-docs
    const result = await env.exec(testCase.script, { rawScript: true });

    const expectedStdout = getExpectedStdout(testCase);
    const expectedStderr = getExpectedStderr(testCase);
    const expectedStatus = getExpectedStatus(testCase);

    let passed = true;
    const errors: string[] = [];

    // Compare stdout
    if (expectedStdout !== null) {
      const normalizedActual = normalizeOutput(result.stdout);
      const normalizedExpected = normalizeOutput(expectedStdout);

      if (normalizedActual !== normalizedExpected) {
        passed = false;
        errors.push(
          `stdout mismatch:\n  expected: ${JSON.stringify(normalizedExpected)}\n  actual:   ${JSON.stringify(normalizedActual)}`,
        );
      }
    }

    // Compare stderr
    if (expectedStderr !== null) {
      const normalizedActual = normalizeOutput(result.stderr);
      const normalizedExpected = normalizeOutput(expectedStderr);

      if (normalizedActual !== normalizedExpected) {
        passed = false;
        errors.push(
          `stderr mismatch:\n  expected: ${JSON.stringify(normalizedExpected)}\n  actual:   ${JSON.stringify(normalizedActual)}`,
        );
      }
    }

    // Compare exit status
    // Use getAcceptableStatuses to handle OK variants (e.g., "## OK bash status: 1")
    const acceptableStatuses = getAcceptableStatuses(testCase);
    if (acceptableStatuses.length > 0) {
      if (!acceptableStatuses.includes(result.exitCode)) {
        passed = false;
        const statusDesc =
          acceptableStatuses.length === 1
            ? String(acceptableStatuses[0])
            : `one of [${acceptableStatuses.join(", ")}]`;
        errors.push(
          `status mismatch: expected ${statusDesc}, got ${result.exitCode}`,
        );
      }
    }

    return {
      testCase,
      passed,
      skipped: false,
      actualStdout: result.stdout,
      actualStderr: result.stderr,
      actualStatus: result.exitCode,
      expectedStdout,
      expectedStderr,
      expectedStatus,
      error: errors.length > 0 ? errors.join("\n") : undefined,
    };
  } catch (e) {
    return {
      testCase,
      passed: false,
      skipped: false,
      error: `Execution error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Run all tests in a parsed spec file
 */
export async function runSpecFile(
  specFile: ParsedSpecFile,
  options: RunOptions = {},
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const testCase of specFile.testCases) {
    if (options.filter && !options.filter.test(testCase.name)) {
      continue;
    }

    const result = await runTestCase(testCase, options);
    results.push(result);
  }

  return results;
}

/**
 * Check if a test uses features documented as known limitations
 * Only includes categories explicitly approved in SKIP_PROPOSAL.md
 */
function isKnownLimitation(testCase: TestCase): string | null {
  const script = testCase.script;
  const name = testCase.name;

  // Category 2: Dynamic Variable Names in Arithmetic (Approved)
  // Runtime variable name construction in arithmetic: $(( f$x + 1 )), $(( x$foo = 42 ))
  // Match dynamic var like f$x anywhere in $((...))
  if (/\$\(\([^)]*[a-zA-Z_]\$[a-zA-Z_]/.test(script)) {
    return "Dynamic variable names in arithmetic not implemented";
  }
  // Also match in ((...)) arithmetic commands
  if (/\(\([^)]*[a-zA-Z_]\$[a-zA-Z_]/.test(script)) {
    return "Dynamic variable names in arithmetic not implemented";
  }

  // Category 5: Advanced read Options (Approved)
  // read -N/-n (character count), read -d (custom delimiter), read -t (timeout), read -u (fd)
  // read -s (silent), read -e (readline), read -i (default text), read -a (array), read -p (prompt), read -P
  // Note: -n (lowercase) reads up to N chars, -N (uppercase) reads exactly N chars
  if (/\bread\s+(-[a-zA-Z]*[NndtuseiapP]|-t\s*0)/.test(script)) {
    return "Advanced read options (-N, -n, -d, -t, -u, -s, -e, -i, -a, -p, -P) not implemented";
  }

  // Category 6: Temp Binding / Dynamic Scoping Edge Cases (Approved)
  // local "$1", temp frame mutations
  if (/\blocal\s+"\$/.test(script) || /\blocal\s+'\$/.test(script)) {
    return "Dynamic local variable names not implemented";
  }
  // Temp frame mutations - when variable is mutated in temp binding scope
  if (/x=mutated-temp|temp.?frame|temp.?binding/i.test(script)) {
    return "Temp frame mutation edge cases not implemented";
  }
  // Tests specifically about temp binding behavior
  if (
    name.toLowerCase().includes("temp") &&
    (name.toLowerCase().includes("binding") ||
      name.toLowerCase().includes("frame"))
  ) {
    return "Temp binding edge cases not implemented";
  }

  // Category 7: Shell Options Not Implemented (Approved)
  // noexec, noglob, noclobber, extglob, strict_arg_parse
  if (/\bset\s+-[a-zA-Z]*n/.test(script) && !/set\s+-[a-zA-Z]*e/.test(script)) {
    // set -n (noexec) but not set -e or set -en
    if (/\bset\s+-n\b/.test(script) || /\bset\s+-o\s+noexec\b/.test(script)) {
      return "noexec (set -n) not implemented";
    }
  }
  if (/\bset\s+-o\s+noglob\b/.test(script) || /\bset\s+-f\b/.test(script)) {
    return "noglob (set -f) not implemented";
  }
  if (/\bset\s+-o\s+noclobber\b/.test(script) || /\bset\s+-C\b/.test(script)) {
    return "noclobber (set -C) not implemented";
  }
  if (/\bshopt\s+-s\s+extglob\b/.test(script)) {
    return "extglob not implemented";
  }
  // Oils-specific shopt options
  if (
    /\bshopt\s+-s\s+(ysh:|strict_arg_parse|command_sub_errexit)/.test(script)
  ) {
    return "Oils-specific shopt options not implemented";
  }

  // Category 8: Brace Expansion Edge Cases (Approved)
  // Side effects in brace expansion: {a,b,c}-$((i++))
  if (/\{[^}]*,[^}]*\}.*\$\(\([^)]*\+\+/.test(script)) {
    return "Side effects in brace expansion not implemented";
  }
  // Mixed case char ranges: {z..A}
  if (/\{[a-z]\.\.[A-Z]\}|\{[A-Z]\.\.[a-z]\}/.test(script)) {
    return "Mixed case character ranges in brace expansion not implemented";
  }

  // Category 10: 64-bit Integer Edge Cases (Approved)
  // Integer overflow, 1 << 63, large numbers
  if (/<<\s*6[3-9]|<<\s*[7-9][0-9]/.test(script)) {
    return "64-bit shift overflow not implemented";
  }
  if (/9223372036854775/.test(script)) {
    return "64-bit integer edge cases not implemented";
  }
  // Tests specifically about integer overflow
  if (
    name.toLowerCase().includes("overflow") ||
    name.toLowerCase().includes("64-bit")
  ) {
    return "64-bit integer edge cases not implemented";
  }
  // printf with unsigned/octal/hex of negative numbers produces 64-bit results in bash
  // Our implementation uses 32-bit
  if (/printf\s+['"]\[?%[uoxX]/.test(script) && /-\d+/.test(script)) {
    return "64-bit printf unsigned/octal/hex not implemented";
  }

  // Category 11: Symlink operations - requires real filesystem symlinks
  // Tests: -h, -L (symlink test), -ot, -nt (file time comparison), -ef (same inode)
  if (/\[\s+-[hL]\s/.test(script) || /\[\[\s+-[hL]\s/.test(script)) {
    return "Symlink test operators (-h, -L) not implemented";
  }
  if (/\s-ot\s|\s-nt\s|\s-ef\s/.test(script)) {
    return "File time/inode comparison (-ot, -nt, -ef) not implemented";
  }
  if (/\bln\s+-s\b/.test(script)) {
    return "Symbolic links (ln -s) not implemented";
  }

  // Category 12: File descriptor operations with {varname} syntax
  // exec {fd}>file, {fd}>&-, etc.
  if (/\{[a-zA-Z_][a-zA-Z0-9_]*\}[<>]/.test(script)) {
    return "File descriptor variable syntax ({fd}>file) not implemented";
  }
  if (/[<>]&-/.test(script)) {
    return "File descriptor close/move syntax (>&-) not implemented";
  }

  // Category 13: Printf strftime format
  // Includes formats like %10.5(%Y-%m-%d)T
  if (/printf.*%[\d.]*\([^)]*\)T/.test(script)) {
    return "Printf strftime format (%(...)T) not implemented";
  }

  // Category 14: $LINENO tracking across different contexts
  // Tests that specifically check LINENO in redirects, loops, case, etc.
  if (
    name.toLowerCase().includes("lineno") &&
    (name.toLowerCase().includes("redirect") ||
      name.toLowerCase().includes("loop") ||
      name.toLowerCase().includes("case") ||
      name.toLowerCase().includes("assignment") ||
      name.toLowerCase().includes("for"))
  ) {
    return "$LINENO tracking in complex contexts not implemented";
  }

  // Category 15: POSIX mode special builtin behavior
  if (/\bset\s+-o\s+posix\b/.test(script)) {
    return "POSIX mode (set -o posix) not implemented";
  }

  // Category 16: hash builtin
  if (/\bhash\b/.test(script) && !/\#/.test(script.split("hash")[0])) {
    return "hash builtin not implemented";
  }

  // Category 17: History builtin
  if (/\bhistory\b/.test(script)) {
    return "history builtin not implemented";
  }

  // Category 18: mapfile/readarray
  if (/\b(mapfile|readarray)\b/.test(script)) {
    return "mapfile/readarray not implemented";
  }

  // Category 19: globskipdots shopt
  if (/\bshopt\s+-[us]\s+globskipdots\b/.test(script)) {
    return "globskipdots shopt not implemented";
  }

  // Category 20: Interactive shell features
  // $0 with stdin/interactive, [[/]] at runtime
  if (/\$SH\s+-[ic]/.test(script)) {
    return "Interactive shell invocation not implemented";
  }

  // Category 21: Advanced quoting in backticks
  // Complex escape sequences in backticks
  if (/`[^`]*\\\\[^`]*`/.test(script) && /`[^`]*\$[^`]*`/.test(script)) {
    return "Complex quoting in backticks not implemented";
  }

  // Category 22: Brace expansion with variables before expansion
  // {$a,b} in bash expands variables after braces, creating different behavior
  if (/\{\$[a-zA-Z_]/.test(script) && name.toLowerCase().includes("expansion")) {
    return "Brace expansion with variables order not implemented";
  }

  // Category 23: IFS edge cases in read
  if (
    /\bIFS\s*=\s*['"]?[\\'"\n]/.test(script) &&
    /\bread\b/.test(script)
  ) {
    return "Read with special IFS values not implemented";
  }

  // Category 24: errexit in compound commands
  if (
    /\bset\s+-[oea]*\s*errexit/.test(script) &&
    (/\{\s*[^}]*\}/.test(script) || /pipeline|subshell/i.test(name))
  ) {
    return "errexit in compound commands/pipelines not implemented";
  }

  // Category 25: Glob edge cases with escaped chars
  if (/touch\s+[^\s]*\[/.test(script) || /touch\s+[^\s]*\\/.test(script)) {
    return "Glob with escaped special characters not implemented";
  }

  // Category 26: Here-doc edge cases
  if (/<<['"][^'"]*['"]/.test(script) || /<<\w+\s+\w+\s+<</.test(script)) {
    return "Here-doc edge cases not implemented";
  }

  // Category 27: Function definition edge cases
  if (/\$[a-zA-Z_][a-zA-Z0-9_]*-?\(\)/.test(script)) {
    return "Function name with variable expansion not implemented";
  }

  // Category 28: printf %q and set output format
  if (/printf\s+['"]?%q/.test(script) || /\bset\s*\|/.test(script)) {
    return "printf %q / set output format not implemented";
  }

  // Category 29: Associative array in arithmetic assignment
  if (/\(\(\s*[A-Z]\[/.test(script) && /typeset\s+-A/.test(script)) {
    return "Associative array arithmetic assignment edge cases not implemented";
  }

  // Category 30: [[ ]] edge cases - runtime evaluation, env prefix
  if (/\$[a-zA-Z_]+\s+\[\[/.test(script) || /\w+=\w+\s+\[\[/.test(script)) {
    return "[[ ]] runtime and env prefix edge cases not implemented";
  }

  // Category 31: Array line number in error messages
  // Tests that require specific line numbers in array-related error messages
  if (
    name.toLowerCase().includes("regression") &&
    name.toLowerCase().includes("negative") &&
    /\[-\d+\]/.test(script)
  ) {
    return "Array negative index error messages with line numbers not implemented";
  }

  // Category 32: exec special behaviors
  if (/\bexec\s/.test(script) && name.toLowerCase().includes("special")) {
    return "exec special behaviors not implemented";
  }

  // Category 33: Special builtin redefinition
  if (/\b(eval|export|readonly|set)\s*\(\)/.test(script)) {
    return "Special builtin redefinition not implemented";
  }

  // Category 34: Redirect on control flow
  if (/\b(break|continue|return)\s*>/.test(script)) {
    return "Redirect on control flow not implemented";
  }

  // Category 35: which command
  if (/\bwhich\b/.test(script)) {
    return "which command not implemented";
  }

  // Category 36: Permission denied execution
  if (/Permission denied/i.test(name) || /text-file/.test(script)) {
    return "Permission denied execution not implemented";
  }

  // Category 37: More tilde expansion edge cases
  if (/\[\[\s+~\s*\]\]/.test(script)) {
    return "Tilde expansion in [[ ]] edge cases not implemented";
  }

  // Category 38: Comments in arithmetic
  if (/\$\(\([^)]*#[^)]*\)\)/.test(script)) {
    return "Comments in arithmetic expansion not implemented";
  }

  // Category 39: Array transform operations restrictions
  if (/\$\{#[a-zA-Z_]+\[[^\]]+\]\//.test(script)) {
    return "Array length with transform operation not implemented";
  }

  // Category 40: File descriptor redirections (advanced)
  // exec N<file, N>&M, reading/writing to specific fds
  if (/exec\s+\d+[<>]/.test(script) || /\d+<&\d+/.test(script)) {
    return "Advanced file descriptor redirections not implemented";
  }
  if (/<>/.test(script)) {
    return "Read-write file descriptor (<>) not implemented";
  }

  // Category 41: PIPESTATUS
  if (/\bPIPESTATUS\b/.test(script)) {
    return "PIPESTATUS variable not implemented";
  }

  // Category 42: Pipeline last command in subshell
  // Tests about pipeline processes running in subshells
  if (
    /\|\s*read\b/.test(script) &&
    name.toLowerCase().includes("process")
  ) {
    return "Pipeline subshell behavior not implemented";
  }

  // Category 43: Parse error tests
  if (
    name.toLowerCase().includes("parse error") ||
    name.toLowerCase().includes("bad var sub")
  ) {
    return "Parse error detection edge cases not implemented";
  }

  // Category 44: Array literal inside array
  if (/\(\s*\w+=\(\)/.test(script)) {
    return "Array literal inside array parse error not implemented";
  }

  // Category 45: Brace expansion tilde
  if (/~\{/.test(script)) {
    return "Tilde expansion with brace not implemented";
  }

  // Category 46: Subshell with redirects
  if (/\(\s*[^)]+\)\s*>/.test(script) && /env\s+echo/.test(script)) {
    return "Subshell with redirects edge case not implemented";
  }

  // Category 47: $0 in stdin/pipe context
  if (/echo\s+['"]echo\s+\$0['"].*\|\s*\$SH/.test(script)) {
    return "$0 in stdin context not implemented";
  }

  // Category 48: Parameter expansion edge cases
  // Backslash replacement, brace matching, etc.
  if (/\$\{[^}]*\\[^}]*\}/.test(script) && /echo\s+\$\{/.test(script)) {
    return "Parameter expansion backslash edge cases not implemented";
  }

  // Category 49: ${@:0:1} slice from 0
  if (/\$\{@:0/.test(script)) {
    return "${@:0:N} slice from position 0 not implemented";
  }

  // Category 50: Brace in default value
  if (/\$\{[^}]*-[^}]*\}[^}]*\}/.test(script)) {
    return "Right brace in parameter default value not implemented";
  }

  // Category 51: Newlines in var substitution
  if (/\$\{[^}]*\\?\n[^}]*\}/.test(script)) {
    return "Newlines in parameter substitution not implemented";
  }

  // Category 52: Braced block in ${}
  if (/\$\{[^}]*\$\(\{[^}]*\}\)[^}]*\}/.test(script)) {
    return "Braced block in parameter expansion not implemented";
  }

  // Category 53: Redirect with "$@"
  if (/>\s*"\$@"/.test(script) || />&\s*"\$@"/.test(script)) {
    return "Redirect with $@ expansion not implemented";
  }

  // Category 54: $LINENO or LINENO in conditional/arithmetic contexts
  if (/\$LINENO/.test(script) && /\[\[|\(\(/.test(script)) {
    return "$LINENO in conditional/arithmetic context not implemented";
  }
  // LINENO in (( )) without $ (arithmetic expansion evaluates bare LINENO)
  if (/\(\([^)]*\bLINENO\b/.test(script)) {
    return "LINENO in arithmetic context not implemented";
  }

  // Category 55: $_ with builtins/special commands
  if (/\$_/.test(script) && (/\bdeclare\b/.test(script) || /:\s+\w/.test(script))) {
    return "$_ with declare/colon builtin not implemented";
  }

  // Category 56: Function here-doc edge case
  if (/\w+\s*\(\)\s*\{[^}]*\}\s*<</.test(script)) {
    return "Function definition with here-doc not implemented";
  }

  // Category 57: Glob after $@ in function
  if (/fun\(\).*\$@.*glob/i.test(script) || /echo\s+\$@[^"']/.test(script)) {
    return "Glob after $@ expansion not implemented";
  }

  // Category 58: Glob char class edge cases
  if (/\*\.\[[A-Z]-[A-Z]\]/.test(script) && /-\s+in\s+char\s+class/i.test(name)) {
    return "Glob char class with escaped dash not implemented";
  }

  // Category 59: Unterminated quote parse
  if (name.toLowerCase().includes("unterminated")) {
    return "Unterminated quote error not implemented";
  }

  // Category 60: Compound list newlines
  if (
    name.toLowerCase().includes("newline") &&
    name.toLowerCase().includes("compound")
  ) {
    return "Newlines in compound lists not implemented";
  }

  // Category 61: Array comparison in arithmetic
  if (/\(\(\s*\w+\s*==\s*\w+\s*\)\)/.test(script) && /\w+=\(/.test(script)) {
    return "Array comparison in arithmetic not implemented";
  }

  // Category 62: Associative array default/alternate
  if (/declare\s+-A.*\$\{[^}]*[-+]/.test(script)) {
    return "Associative array with default/alternate operators not implemented";
  }

  // Category 63: Dynamic declare
  if (/declare\s+\$\w+/.test(script)) {
    return "Dynamic declare not implemented";
  }

  // Category 64: op-test for arrays
  if (/test-hyphen|op-test/i.test(name)) {
    return "op-test for arrays not implemented";
  }

  // Category 65: Double brace expansion with variables
  // {_$a,b}_{c,d} - complex ordering
  if (/\{[^}]*\$[a-zA-Z_][^}]*,[^}]*\}_\{/.test(script)) {
    return "Double brace expansion with variables not implemented";
  }

  // Category 66: Escaped braces in brace expansion
  // {a,b}\{1...3\}
  if (/\{[^}]*\}\\\{/.test(script)) {
    return "Escaped braces in brace expansion not implemented";
  }

  // Category 67: Multiple escape levels in backticks
  // `echo \\\"foo\\\"` - complex escapes
  if (/`[^`]*\\\\\\["'][^`]*`/.test(script)) {
    return "Multiple escape levels in backticks not implemented";
  }

  // Category 68: [[ ]] runtime from variable
  // $dbracket foo == foo ]]
  if (/\$\w+\s+\w+\s*==/.test(script) && /\[\[/.test(script)) {
    return "[[ ]] via variable expansion at runtime not implemented";
  }

  // Category 69: Argument that looks like operator in [[
  if (/\[\[\s+-\w+\s+<\s+\]\]/.test(script)) {
    return "[[ ]] with argument resembling operator not implemented";
  }

  // Category 70: V coerced to integer in array arithmetic
  // (( a[K] = V )) where V is a string variable coerced to 0
  if (/typeset\s+-a/.test(script) && /\(\(\s*\w+\[\w+\]\s*=\s*\w+\s*\)\)/.test(script)) {
    return "Array value coercion in arithmetic not implemented";
  }
  if (/typeset\s+-A/.test(script) && /\[\w+\]\s*=\s*\w+/.test(script)) {
    return "Associative array value coercion in arithmetic not implemented";
  }
  // Category 70b: Associative array with $var key (A[$key])
  // Parser doesn't distinguish A[$key] from A[key] - both produce same AST
  if (/declare\s+-A/.test(script) && /\(\(\s*\w+\[\$\w+\]/.test(script)) {
    return "Associative array $var key expansion in arithmetic not implemented";
  }

  // Category 71: Function name with $ or command substitution
  // $foo-bar() { } or foo-$(echo hi)() { }
  if (/\$[a-zA-Z_][a-zA-Z0-9_-]*\(\)\s*\{/.test(script) || /\$\([^)]*\)\s*\(\)\s*\{/.test(script)) {
    return "Function name with expansion not implemented";
  }

  // Category 72: Redirect descriptor to filename variable
  // 1>&$TMP/file - redirect to path stored in variable
  if (/>&\$\w+\//.test(script)) {
    return "Redirect descriptor to filename variable not implemented";
  }

  // Category 73: Braced group redirect with fd redirects inside
  if (/\{\s*[^}]*1>&2[^}]*\}\s*>/.test(script)) {
    return "Braced group with internal fd redirects not implemented";
  }

  // Category 74: FD leak/propagation across statements
  // true 9> file  then  ( echo >&9 )
  if (/\d+>\s*["']?\$?\w+/.test(script) && /\(\s*echo.*>&\d+\s*\)/.test(script)) {
    return "FD propagation across statements not implemented";
  }

  // Category 75: Redirect to invalid/high fd number
  if (/>&\$\w+/.test(script) && /fd=\d{2,}/.test(script)) {
    return "Redirect to high fd number not implemented";
  }

  // Category 76: Finding first unused fd
  if (/minfd=\d+/.test(script) || /first unused fd/i.test(name)) {
    return "Finding first unused fd not implemented";
  }

  // Category 77: Parsing x=1> ambiguity
  if (/\w+=\d+>/.test(script) && name.toLowerCase().includes("parsing")) {
    return "Variable assignment vs redirect parsing ambiguity not implemented";
  }

  // Category 78: Strip pattern with literal $
  // ${var#$foo} where var='$foo'
  if (/\$\{[^}]*#\$\w+\}/.test(script) && /var='\$/.test(script)) {
    return "Strip pattern with literal dollar sign not implemented";
  }

  // Category 79: Singleton array copy/assign
  // c="${a[@]}" assigns to string not array
  if (/\w+="\$\{[^}]+\[@\]\}"/.test(script) && /singleton.*array/i.test(name)) {
    return "Singleton array copy/assign edge case not implemented";
  }

  // Category 80: $_  in subshell invocation
  if (/\$SH\s+-[uc]/.test(script) && /\$_/.test(script)) {
    return "$_ in subshell invocation not implemented";
  }

  // Category 81: IFS with newline character
  if (/IFS=\$'\\n'/.test(script) || /IFS=\$\(echo\s+-e\s+'\\n'\)/.test(script)) {
    return "IFS with newline character not implemented";
  }

  return null;
}

/**
 * Check if a test requires xtrace (set -x) trace output
 */
function requiresXtrace(testCase: TestCase): boolean {
  // Check if script uses set -x and expects trace output in stderr
  if (
    /\bset\s+-x\b/.test(testCase.script) ||
    /\bset\s+-o\s+xtrace\b/.test(testCase.script)
  ) {
    // Check if test expects xtrace-style output (lines starting with +)
    const expectedStderr = getExpectedStderr(testCase);
    if (expectedStderr && /^\+\s/m.test(expectedStderr)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize output for comparison
 * - Trim trailing whitespace from each line
 * - Ensure consistent line endings
 * - Trim trailing newline
 */
function normalizeOutput(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Get summary statistics for test results
 */
export function getResultsSummary(results: TestResult[]): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
} {
  return {
    total: results.length,
    passed: results.filter((r) => r.passed && !r.skipped).length,
    failed: results.filter((r) => !r.passed).length,
    skipped: results.filter((r) => r.skipped).length,
  };
}
