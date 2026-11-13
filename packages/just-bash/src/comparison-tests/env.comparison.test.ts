import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

describe("env command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("exported environment", () => {
    it.each([
      [
        "dotted environment names",
        "env 'HTTP.PROXY=value' printenv HTTP.PROXY",
      ],
      [
        "dotted names in an empty environment",
        "env -i 'foo.bar=value' printenv foo.bar",
      ],
      ["hyphenated environment names", "env 'A-B=value' printenv A-B"],
      ["names starting with a digit", "env -i '1X=value' printenv 1X"],
      ["numeric environment names", "env -i '1=value' printenv 1"],
      [
        "non-identifier names through nested env",
        "env -i 'A.B=value' env printenv A.B",
      ],
      [
        "nested shells do not export positional parameters",
        "bash -c 'printenv 1' _ secret",
      ],
      [
        "unset restores a shadowed outer export",
        "export JB_VALUE=outer; f() { local JB_VALUE=inner; unset JB_VALUE; }; f; printenv JB_VALUE",
      ],
      [
        "unexporting a local restores the outer export",
        "export JB_VALUE=outer; f() { local JB_VALUE=inner; export -n JB_VALUE; }; f; env printenv JB_VALUE",
      ],
      [
        "local -x exports only the local value",
        'JB_VALUE=outer; f() { local -x JB_VALUE="hello world"; printenv JB_VALUE; env printenv JB_VALUE; }; f; printenv JB_VALUE',
      ],
      [
        "local -x exports assignments made later",
        "f() { local -x JB_VALUE; JB_VALUE=value; printenv JB_VALUE; }; f",
      ],
      [
        "export resolves namerefs to their target",
        "JB_VALUE=value; declare -n JB_REF=JB_VALUE; export JB_REF; printenv JB_VALUE; env printenv JB_VALUE; printenv JB_REF",
      ],
      [
        "export assignments and unexporting resolve namerefs",
        "JB_VALUE=value; declare -n JB_REF=JB_VALUE; export JB_REF+=more; printenv JB_VALUE; export -n JB_REF; printenv JB_VALUE",
      ],
      ["empty env stays empty", "env -i env"],
      ["empty printenv stays empty", "env -i printenv"],
      [
        "env excludes local variables",
        "JB_LOCAL=local; export JB_EXPORTED=exported; env | grep '^JB_' | sort",
      ],
      [
        "printenv excludes local variables",
        "JB_LOCAL=local; printenv JB_LOCAL",
      ],
      [
        "printenv lists only exported variables",
        "JB_LOCAL=local; export JB_EXPORTED=exported; printenv | grep '^JB_' | sort",
      ],
      [
        "printenv preserves missing-variable status",
        "JB_LOCAL=local; export JB_EXPORTED=exported; printenv JB_LOCAL JB_EXPORTED",
      ],
      [
        "prefix assignments are exported",
        "JB_PREFIX=temporary env | grep '^JB_'",
      ],
      [
        "unexported values stay local",
        "export JB_REMOVED=value; export -n JB_REMOVED; printenv JB_REMOVED",
      ],
      [
        "env command does not export local variables",
        "JB_LOCAL=local; env bash -c 'echo \"[$JB_LOCAL]\"'",
      ],
      [
        "empty environments export their assignments",
        "env -i JB_ONLY=value printenv JB_ONLY",
      ],
      [
        "nested empty environments stay empty",
        "export JB_EXPORTED=value; env -i env printenv JB_EXPORTED",
      ],
    ])("%s", async (_name, command) => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(
        env,
        testDir,
        command,
        undefined,
        undefined,
        import.meta.url,
      );
    });
  });

  describe("output format", () => {
    it("should output in KEY=value format", async () => {
      // Create env with known variables
      const env = new Bash({
        cwd: testDir,
        env: { TEST_VAR: "test_value" },
      });

      const envResult = await env.exec("env");

      // Check that it contains TEST_VAR=test_value
      expect(envResult.stdout).toContain("TEST_VAR=test_value");
      expect(envResult.exitCode).toBe(0);
    });
  });
});

describe("printenv command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("specific variable", () => {
    it("should print specific variable value", async () => {
      // Use a common environment variable that exists in both
      const env = new Bash({
        cwd: testDir,
        env: { HOME: "/home/testuser" },
      });

      const envResult = await env.exec("printenv HOME");
      expect(envResult.stdout).toBe("/home/testuser\n");
      expect(envResult.exitCode).toBe(0);
    });

    it("should return exit code 1 for non-existent variable", async () => {
      const env = await setupFiles(testDir, {});

      const envResult = await env.exec("printenv NONEXISTENT_VAR_12345");
      const realResult = await runRealBash(
        "printenv NONEXISTENT_VAR_12345",
        testDir,
      );

      expect(envResult.exitCode).toBe(realResult.exitCode);
      expect(envResult.exitCode).toBe(1);
    });
  });

  describe("multiple variables", () => {
    it("should print multiple variable values", async () => {
      const env = new Bash({
        cwd: testDir,
        env: { VAR1: "value1", VAR2: "value2" },
      });

      const envResult = await env.exec("printenv VAR1 VAR2");
      expect(envResult.stdout).toBe("value1\nvalue2\n");
      expect(envResult.exitCode).toBe(0);
    });
  });
});
