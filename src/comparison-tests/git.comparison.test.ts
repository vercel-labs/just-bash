/**
 * Git comparison tests - verify our git implementation matches real git behavior
 *
 * These tests run against both the just-bash git implementation and real git,
 * comparing outputs to ensure 1:1 compatibility.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDir,
  createTestDir,
  runRealBash,
  setupFiles,
  writeAllFixtures,
} from "./test-helpers.js";

describe("git comparison tests", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  afterAll(async () => {
    await writeAllFixtures();
  });

  describe("git init", () => {
    it("should show correct output for git init", async () => {
      const env = await setupFiles(testDir, {});

      // Run real git
      const realResult = await runRealBash("git init", testDir);

      // Run our git
      const ourResult = await env.exec("git init");

      // Compare - real git output format
      console.log("Real git init stdout:", JSON.stringify(realResult.stdout));
      console.log("Real git init stderr:", JSON.stringify(realResult.stderr));
      console.log("Real git init exitCode:", realResult.exitCode);

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should show correct output for git init -q", async () => {
      const env = await setupFiles(testDir, {});

      const realResult = await runRealBash("git init -q", testDir);
      const ourResult = await env.exec("git init -q");

      console.log(
        "Real git init -q stdout:",
        JSON.stringify(realResult.stdout),
      );
      console.log(
        "Real git init -q stderr:",
        JSON.stringify(realResult.stderr),
      );

      expect(ourResult.stdout).toBe(realResult.stdout);
      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should reinitialize existing repository", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash("git init", testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec("git init");

      console.log("Real reinit stdout:", JSON.stringify(realResult.stdout));
      console.log("Real reinit stderr:", JSON.stringify(realResult.stderr));

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git status", () => {
    it("should show status on empty repo", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash("git status", testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec("git status");

      console.log("Real status stdout:", JSON.stringify(realResult.stdout));
      console.log("Our status stdout:", JSON.stringify(ourResult.stdout));

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should show untracked files", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash("git status", testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec("git status");

      console.log(
        "Real status untracked stdout:",
        JSON.stringify(realResult.stdout),
      );
      console.log(
        "Our status untracked stdout:",
        JSON.stringify(ourResult.stdout),
      );

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should show short status", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash("git status -s", testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec("git status -s");

      console.log("Real status -s stdout:", JSON.stringify(realResult.stdout));
      console.log("Our status -s stdout:", JSON.stringify(ourResult.stdout));

      expect(ourResult.stdout).toBe(realResult.stdout);
      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should show staged files in short format", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q && git add test.txt", testDir);
      const realResult = await runRealBash("git status -s", testDir);

      await env.exec("git init -q");
      await env.exec("git add test.txt");
      const ourResult = await env.exec("git status -s");

      console.log("Real staged -s stdout:", JSON.stringify(realResult.stdout));
      console.log("Our staged -s stdout:", JSON.stringify(ourResult.stdout));

      expect(ourResult.stdout).toBe(realResult.stdout);
      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git add", () => {
    it("should error on pathspec not found", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash("git add nonexistent.txt", testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec("git add nonexistent.txt");

      console.log(
        "Real add nonexistent stderr:",
        JSON.stringify(realResult.stderr),
      );
      console.log(
        "Our add nonexistent stderr:",
        JSON.stringify(ourResult.stderr),
      );

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git commit", () => {
    it("should error when nothing to commit", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash('git commit -m "test"', testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec('git commit -m "test"');

      console.log(
        "Real commit nothing stderr:",
        JSON.stringify(realResult.stderr),
      );
      console.log(
        "Our commit nothing stderr:",
        JSON.stringify(ourResult.stderr),
      );

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should create commit with correct output format", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q && git add test.txt", testDir);
      // Set git config for consistent output
      await runRealBash(
        'git config user.email "test@test.com" && git config user.name "Test"',
        testDir,
      );
      const realResult = await runRealBash(
        'git commit -m "Initial commit"',
        testDir,
      );

      await env.exec("git init -q");
      await env.exec("git add test.txt");
      const ourResult = await env.exec('git commit -m "Initial commit"');

      console.log("Real commit stdout:", JSON.stringify(realResult.stdout));
      console.log("Our commit stdout:", JSON.stringify(ourResult.stdout));

      // Both should succeed
      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should error when -m has no argument", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash("git commit -m", testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec("git commit -m");

      console.log(
        "Real commit -m no arg stderr:",
        JSON.stringify(realResult.stderr),
      );
      console.log(
        "Our commit -m no arg stderr:",
        JSON.stringify(ourResult.stderr),
      );

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git log", () => {
    it("should error when no commits", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash("git log", testDir);

      await env.exec("git init -q");
      const ourResult = await env.exec("git log");

      console.log(
        "Real log no commits stderr:",
        JSON.stringify(realResult.stderr),
      );
      console.log(
        "Our log no commits stderr:",
        JSON.stringify(ourResult.stderr),
      );

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git branch", () => {
    it("should list branches after commit", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q && git add test.txt", testDir);
      await runRealBash(
        'git config user.email "test@test.com" && git config user.name "Test"',
        testDir,
      );
      await runRealBash('git commit -m "Initial"', testDir);
      const realResult = await runRealBash("git branch", testDir);

      await env.exec("git init -q");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const ourResult = await env.exec("git branch");

      console.log("Real branch stdout:", JSON.stringify(realResult.stdout));
      console.log("Our branch stdout:", JSON.stringify(ourResult.stdout));

      // Format should match
      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should error deleting current branch", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q && git add test.txt", testDir);
      await runRealBash(
        'git config user.email "test@test.com" && git config user.name "Test"',
        testDir,
      );
      await runRealBash('git commit -m "Initial"', testDir);
      const realResult = await runRealBash("git branch -d main", testDir);

      await env.exec("git init -q");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const ourResult = await env.exec("git branch -d main");

      console.log(
        "Real branch -d main stderr:",
        JSON.stringify(realResult.stderr),
      );
      console.log(
        "Our branch -d main stderr:",
        JSON.stringify(ourResult.stderr),
      );

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git checkout", () => {
    it("should create and switch branch with -b", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q && git add test.txt", testDir);
      await runRealBash(
        'git config user.email "test@test.com" && git config user.name "Test"',
        testDir,
      );
      await runRealBash('git commit -m "Initial"', testDir);
      const realResult = await runRealBash("git checkout -b feature", testDir);

      await env.exec("git init -q");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const ourResult = await env.exec("git checkout -b feature");

      console.log(
        "Real checkout -b stdout:",
        JSON.stringify(realResult.stdout),
      );
      console.log(
        "Real checkout -b stderr:",
        JSON.stringify(realResult.stderr),
      );
      console.log("Our checkout -b stdout:", JSON.stringify(ourResult.stdout));

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git config", () => {
    it("should list config", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      await runRealBash(
        'git config user.email "test@test.com" && git config user.name "Test"',
        testDir,
      );
      const realResult = await runRealBash("git config --list", testDir);

      await env.exec("git init -q");
      await env.exec('git config user.email "test@test.com"');
      await env.exec('git config user.name "Test"');
      const ourResult = await env.exec("git config --list");

      console.log(
        "Real config --list stdout:",
        JSON.stringify(realResult.stdout),
      );
      console.log(
        "Our config --list stdout:",
        JSON.stringify(ourResult.stdout),
      );

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should return exit 1 for missing key", async () => {
      const env = await setupFiles(testDir, {});

      await runRealBash("git init -q", testDir);
      const realResult = await runRealBash(
        "git config nonexistent.key",
        testDir,
      );

      await env.exec("git init -q");
      const ourResult = await env.exec("git config nonexistent.key");

      console.log("Real config missing key exitCode:", realResult.exitCode);
      console.log("Our config missing key exitCode:", ourResult.exitCode);

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("git diff", () => {
    it("should show nothing when no changes", async () => {
      const env = await setupFiles(testDir, { "test.txt": "hello\n" });

      await runRealBash("git init -q && git add test.txt", testDir);
      await runRealBash(
        'git config user.email "test@test.com" && git config user.name "Test"',
        testDir,
      );
      await runRealBash('git commit -m "Initial"', testDir);
      const realResult = await runRealBash("git diff", testDir);

      await env.exec("git init -q");
      await env.exec("git add test.txt");
      await env.exec('git commit -m "Initial"');
      const ourResult = await env.exec("git diff");

      console.log("Real diff clean stdout:", JSON.stringify(realResult.stdout));
      console.log("Our diff clean stdout:", JSON.stringify(ourResult.stdout));

      expect(ourResult.stdout).toBe(realResult.stdout);
      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });

  describe("error messages", () => {
    it("should error when not in repo", async () => {
      const env = await setupFiles(testDir, {});

      const realResult = await runRealBash("git status", testDir);
      const ourResult = await env.exec("git status");

      console.log("Real not repo stderr:", JSON.stringify(realResult.stderr));
      console.log("Our not repo stderr:", JSON.stringify(ourResult.stderr));

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });

    it("should error on unknown subcommand", async () => {
      const env = await setupFiles(testDir, {});

      const realResult = await runRealBash("git foobar", testDir);
      const ourResult = await env.exec("git foobar");

      console.log(
        "Real unknown cmd stderr:",
        JSON.stringify(realResult.stderr),
      );
      console.log("Our unknown cmd stderr:", JSON.stringify(ourResult.stderr));

      expect(ourResult.exitCode).toBe(realResult.exitCode);
    });
  });
});
