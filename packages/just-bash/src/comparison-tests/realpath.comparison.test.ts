import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDir,
  createTestDir,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

function hasExecutable(name: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((directory) => {
    try {
      accessSync(join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const hasHostRealpath = hasExecutable("realpath");
const hasGnuRealpath =
  hasHostRealpath &&
  spawnSync("realpath", ["--version"], { encoding: "utf8" }).stdout.includes(
    "GNU coreutils",
  );

/*
 * `realpath` is not a POSIX utility and is missing on some supported hosts.
 * Keep these comparisons when available without making the host tool a test prerequisite.
 */
const hostIt = hasHostRealpath ? it : it.skip;
const gnuIt = hasGnuRealpath ? it : it.skip;

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

  hostIt("canonicalizes a regular file", async () => {
    const env = await setupFiles(testDir, { "file.txt": "content\n" });
    const envResult = await env.exec("realpath file.txt");
    const realResult = await runRealBash("realpath file.txt", testDir);

    expect(envResult.exitCode).toBe(realResult.exitCode);
    expect(envResult.stdout.endsWith("/file.txt\n")).toBe(true);
    expect(realResult.stdout.endsWith("/file.txt\n")).toBe(true);
  });

  hostIt("follows a symlink chain", async () => {
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

  hostIt("fails for a missing intermediate path", async () => {
    const env = await setupFiles(testDir, {});
    const envResult = await env.exec("realpath missing/child");
    const realResult = await runRealBash("realpath missing/child", testDir);

    expect(envResult.exitCode).toBe(realResult.exitCode);
    expect(envResult.stdout).toBe("");
    expect(realResult.stdout).toBe("");
    expect(envResult.stderr).toContain("realpath:");
    expect(realResult.stderr).toContain("realpath:");
  });

  gnuIt("accepts missing and dangling final components", async () => {
    const env = await setupFiles(testDir, {});
    const setup = "ln -s missing-target dangling";
    const envSetup = await env.exec(setup);
    const realSetup = await runRealBash(setup, testDir);
    const envResult = await env.exec("realpath missing/ dangling/");
    const realResult = await runRealBash(
      "realpath missing/ dangling/",
      testDir,
    );

    expect(envSetup.exitCode).toBe(realSetup.exitCode);
    expect(envResult.exitCode).toBe(realResult.exitCode);
    expect(
      envResult.stdout
        .split("\n")
        .slice(0, 2)
        .map((value) => value.slice(value.lastIndexOf("/"))),
    ).toEqual(["/missing", "/missing-target"]);
    expect(
      realResult.stdout
        .split("\n")
        .slice(0, 2)
        .map((value) => value.slice(value.lastIndexOf("/"))),
    ).toEqual(["/missing", "/missing-target"]);
  });
});
