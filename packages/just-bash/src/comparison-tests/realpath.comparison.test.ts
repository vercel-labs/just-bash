import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDir,
  createTestDir,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

describe("realpath command - Real Bash Comparison", () => {
  // Host realpath may canonicalize a temporary /var root to /private/var;
  // compare stable path suffixes while still checking the exact terminator.
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("canonicalizes a regular file", async () => {
    const env = await setupFiles(testDir, { "file.txt": "content\n" });
    const envResult = await env.exec("realpath file.txt");
    const realResult = await runRealBash("realpath file.txt", testDir);

    expect(envResult.exitCode).toBe(realResult.exitCode);
    expect(envResult.stdout.endsWith("/file.txt\n")).toBe(true);
    expect(realResult.stdout.endsWith("/file.txt\n")).toBe(true);
  });

  it("follows a symlink chain", async () => {
    const env = await setupFiles(testDir, { "target/file.txt": "content\n" });
    const setup = "ln -s target intermediate && ln -s intermediate linked";
    const envSetup = await env.exec(setup);
    const realSetup = await runRealBash(setup, testDir);
    const envResult = await env.exec("realpath linked/file.txt");
    const realResult = await runRealBash("realpath linked/file.txt", testDir);

    expect(envSetup.exitCode).toBe(realSetup.exitCode);
    expect(envResult.exitCode).toBe(realResult.exitCode);
    expect(envResult.stdout.endsWith("/target/file.txt\n")).toBe(true);
    expect(realResult.stdout.endsWith("/target/file.txt\n")).toBe(true);
  });

  it("fails for a missing path", async () => {
    const env = await setupFiles(testDir, {});
    const envResult = await env.exec("realpath missing");
    const realResult = await runRealBash("realpath missing", testDir);

    expect(envResult.exitCode).toBe(realResult.exitCode);
    expect(envResult.stdout).toBe("");
    expect(realResult.stdout).toBe("");
    expect(envResult.stderr).toContain("realpath:");
    expect(realResult.stderr).toContain("realpath:");
  });
});
