import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import {
  cleanupTestDir,
  createTestDir,
  runRealBash,
  setupFiles,
} from "./test-helpers.js";

describe("env command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
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
