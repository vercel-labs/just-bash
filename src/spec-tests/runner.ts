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
