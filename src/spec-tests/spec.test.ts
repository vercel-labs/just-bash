/**
 * Vitest runner for Oils spec tests
 *
 * This runs the imported spec tests from the Oils project against BashEnv.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSpecFile } from "./parser.js";
import { runTestCase } from "./runner.js";

const CASES_DIR = path.join(__dirname, "cases");

// Test files by priority - start with simpler ones
const TEST_FILES = [
  "builtin-echo.test.sh",
  "comments.test.sh",
  "assign.test.sh",
  "arith.test.sh",
  "if_.test.sh",
  "loop.test.sh",
  "case_.test.sh",
  // Additional test files
  "tilde.test.sh",
  "var-op-len.test.sh",
  "var-op-strip.test.sh",
  "command-sub.test.sh",
  // More test files
  "word-eval.test.sh",
  "dparen.test.sh",
  "var-sub-quote.test.sh",
  "quote.test.sh",
  // Even more test files
  "var-op-test.test.sh",
  "pipeline.test.sh",
  "redirect.test.sh",
  // Additional fundamental tests
  "exit-status.test.sh",
  "subshell.test.sh",
  "glob.test.sh",
  "here-doc.test.sh",
  // Builtin tests
  "builtin-printf.test.sh",
  "builtin-cd.test.sh",
  // More tests
  "var-sub.test.sh",
  "let.test.sh",
  "empty-bodies.test.sh",
  "func-parsing.test.sh",
  "errexit.test.sh",
  "vars-special.test.sh",
  // Additional test files - FIRST HALF
  "builtin-bracket.test.sh",
  "builtin-read.test.sh",
  "builtin-eval-source.test.sh",
  "builtin-misc.test.sh",
  "builtin-type.test.sh",
  "builtin-special.test.sh",
  "builtin-set.test.sh",
  "command_.test.sh",
  "command-parsing.test.sh",
  "var-op-slice.test.sh",
  // SECOND HALF - first part
  "var-op-patsub.test.sh",
  "var-num.test.sh",
  "word-split.test.sh",
  "sh-func.test.sh",
  "temp-binding.test.sh",
  // SECOND HALF - second part
  "posix.test.sh",
  "strict-options.test.sh",
  "parse-errors.test.sh",
  "dbracket.test.sh",
  "whitespace.test.sh",
  "smoke.test.sh",
  // Array tests
  "array-basic.test.sh",
  "array.test.sh",
  // More arithmetic tests
  "arith-context.test.sh",
  // Brace expansion - CRASHES worker, needs investigation
  "brace-expansion.test.sh",
];

/**
 * Truncate script for test name display
 */
function truncateScript(script: string, maxLen = 60): string {
  // Normalize whitespace and get first meaningful line(s)
  const normalized = script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .join(" | ");

  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen - 3)}...`;
}

/**
 * Format error message for debugging
 */
function formatError(result: Awaited<ReturnType<typeof runTestCase>>): string {
  const lines: string[] = [];

  if (result.expectedStdout !== null || result.actualStdout !== undefined) {
    lines.push("STDOUT:");
    lines.push(`  expected: ${JSON.stringify(result.expectedStdout ?? "")}`);
    lines.push(`  actual:   ${JSON.stringify(result.actualStdout ?? "")}`);
  }

  if (result.expectedStderr !== null || result.actualStderr) {
    lines.push("STDERR:");
    lines.push(`  expected: ${JSON.stringify(result.expectedStderr ?? "")}`);
    lines.push(`  actual:   ${JSON.stringify(result.actualStderr ?? "")}`);
  }

  if (result.expectedStatus !== null || result.actualStatus !== undefined) {
    lines.push("STATUS:");
    lines.push(`  expected: ${result.expectedStatus ?? "(not checked)"}`);
    lines.push(`  actual:   ${result.actualStatus}`);
  }

  lines.push("");
  lines.push("SCRIPT:");
  lines.push(result.testCase.script);

  return lines.join("\n");
}

describe("Oils Spec Tests", () => {
  for (const fileName of TEST_FILES) {
    const filePath = path.join(CASES_DIR, fileName);

    describe(fileName, () => {
      // Parse must succeed - this is not optional
      const content = fs.readFileSync(filePath, "utf-8");
      const specFile = parseSpecFile(content, filePath);

      // Must have test cases
      if (specFile.testCases.length === 0) {
        throw new Error(`No test cases found in ${fileName}`);
      }

      for (const testCase of specFile.testCases) {
        // Include truncated script in test name for easier debugging
        const scriptPreview = truncateScript(testCase.script);
        const testName = `[L${testCase.lineNumber}] ${testCase.name}: ${scriptPreview}`;

        it(testName, async () => {
          const result = await runTestCase(testCase, {
            skipExternal: true,
          });

          if (result.skipped) {
            return;
          }

          if (!result.passed) {
            expect.fail(formatError(result));
          }
        });
      }
    });
  }
});
