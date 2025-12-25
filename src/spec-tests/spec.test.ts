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
