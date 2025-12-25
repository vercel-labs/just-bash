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

// Only test these files for now
const TEST_FILES = ["builtin-echo.test.sh"];

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
        it(`${testCase.name} (line ${testCase.lineNumber})`, async () => {
          const result = await runTestCase(testCase, {
            skipExternal: true,
          });

          if (result.skipped) {
            return;
          }

          if (!result.passed) {
            expect.fail(
              `Test failed: ${result.error}\n\nScript:\n${testCase.script}`,
            );
          }
        });
      }
    });
  }
});
