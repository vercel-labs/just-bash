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
