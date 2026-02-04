import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { Bash } from "../Bash.js";

const execAsync: (
  command: string,
  options?: { cwd?: string; shell?: string },
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

/**
 * Check if we're in record mode (recording bash outputs to fixtures)
 * - "1" = record mode, but skip locked fixtures
 * - "force" = record mode, overwrite even locked fixtures
 */
export const isRecordMode: boolean =
  process.env.RECORD_FIXTURES === "1" ||
  process.env.RECORD_FIXTURES === "force";

/**
 * Force mode overwrites even locked fixtures
 */
const isForceRecordMode: boolean = process.env.RECORD_FIXTURES === "force";

/**
 * Fixture entry for a single test case
 */
export interface FixtureEntry {
  command: string;
  files: Record<string, string>;
  stdout: string;
  stderr: string;
  exitCode: number;
  /**
   * If true, this fixture has been manually adjusted (e.g., for Linux behavior)
   * and will not be overwritten during recording unless RECORD_FIXTURES=force
   */
  locked?: boolean;
}

/**
 * Fixtures file format - keyed by fixture ID
 */
export interface FixturesFile {
  [fixtureId: string]: FixtureEntry;
}

/**
 * In-memory cache of loaded fixtures per test file
 */
const fixturesCache = new Map<string, FixturesFile>();

/**
 * Pending fixtures to write (accumulated during test run in record mode)
 */
const pendingFixtures = new Map<string, FixturesFile>();

/**
 * Store the files set up by setupFiles so compareOutputs can access them
 * Key is testDir path, value is the files object
 */
const setupFilesRegistry = new Map<string, Record<string, string>>();

/**
 * Generate a unique fixture ID from command and files
 */
function generateFixtureId(
  command: string,
  files: Record<string, string>,
): string {
  // Sort files for consistent hashing
  const sortedFiles = Object.keys(files)
    .sort()
    .map((k) => `${k}:${files[k]}`)
    .join("|");
  const content = `${command}|||${sortedFiles}`;
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Get the fixtures file path for a test file
 */
function getFixturesPath(testFile: string): string {
  const dir = path.dirname(testFile);
  const base = path.basename(testFile, ".test.ts");
  return path.join(dir, "fixtures", `${base}.fixtures.json`);
}

/**
 * Load fixtures from disk
 */
async function loadFixtures(testFile: string): Promise<FixturesFile> {
  const cached = fixturesCache.get(testFile);
  if (cached) {
    return cached;
  }

  const fixturesPath = getFixturesPath(testFile);
  try {
    const content = await fs.readFile(fixturesPath, "utf-8");
    const fixtures = JSON.parse(content) as FixturesFile;
    fixturesCache.set(testFile, fixtures);
    return fixtures;
  } catch {
    // No fixtures file yet
    // @banned-pattern-ignore: test infrastructure, keys are fixture IDs from developer-controlled test files
    const empty: FixturesFile = {};
    fixturesCache.set(testFile, empty);
    return empty;
  }
}

/**
 * Track which fixtures were skipped due to being locked
 */
const skippedLockedFixtures: Array<{
  testFile: string;
  fixtureId: string;
  command: string;
}> = [];

/**
 * Save a fixture entry (in record mode)
 * Returns true if recorded, false if skipped due to lock
 */
async function recordFixture(
  testFile: string,
  fixtureId: string,
  entry: FixtureEntry,
): Promise<boolean> {
  // Check if existing fixture is locked
  if (!isForceRecordMode) {
    const existingFixtures = await loadFixtures(testFile);
    const existing = existingFixtures[fixtureId];
    if (existing?.locked) {
      skippedLockedFixtures.push({
        testFile,
        fixtureId,
        command: entry.command,
      });
      return false;
    }
  }

  let fixtures = pendingFixtures.get(testFile);
  if (!fixtures) {
    fixtures = {};
    pendingFixtures.set(testFile, fixtures);
  }
  fixtures[fixtureId] = entry;
  return true;
}

/**
 * Write all pending fixtures to disk (call after all tests complete)
 */
export async function writeAllFixtures(): Promise<void> {
  for (const [testFile, newFixtures] of pendingFixtures.entries()) {
    const fixturesPath = getFixturesPath(testFile);

    // Ensure fixtures directory exists
    await fs.mkdir(path.dirname(fixturesPath), { recursive: true });

    // Load existing fixtures and merge
    // @banned-pattern-ignore: test infrastructure, keys are fixture IDs from developer-controlled test files
    let existingFixtures: FixturesFile = {};
    try {
      const content = await fs.readFile(fixturesPath, "utf-8");
      existingFixtures = JSON.parse(content) as FixturesFile;
    } catch {
      // No existing file
    }

    // Merge new fixtures (new ones overwrite old, but preserve locked status)
    const mergedFixtures = { ...existingFixtures };
    for (const [key, value] of Object.entries(newFixtures)) {
      // Preserve locked status from existing fixture if not in force mode
      const existing = existingFixtures[key];
      if (existing?.locked && !isForceRecordMode) {
        // Keep existing locked fixture
        continue;
      }
      mergedFixtures[key] = value;
    }

    // Sort by fixture ID for consistent output
    // @banned-pattern-ignore: test infrastructure, keys are fixture IDs from developer-controlled test files
    const sortedFixtures: FixturesFile = {};
    for (const key of Object.keys(mergedFixtures).sort()) {
      sortedFixtures[key] = mergedFixtures[key];
    }

    await fs.writeFile(
      fixturesPath,
      `${JSON.stringify(sortedFixtures, null, 2)}\n`,
    );
    console.log(`Wrote fixtures to ${fixturesPath}`);
  }

  // Report skipped locked fixtures
  if (skippedLockedFixtures.length > 0) {
    console.log(
      "\n⚠️  Skipped locked fixtures (use RECORD_FIXTURES=force to override):",
    );
    for (const { testFile, command } of skippedLockedFixtures) {
      const basename = path.basename(testFile);
      console.log(`   - ${basename}: "${command}"`);
    }
  }
}

/**
 * Creates a unique temp directory for testing
 */
export async function createTestDir(): Promise<string> {
  const testDir = path.join(
    os.tmpdir(),
    `bashenv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Cleans up the temp directory
 */
export async function cleanupTestDir(testDir: string): Promise<void> {
  // Clean up registry entry
  setupFilesRegistry.delete(testDir);

  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Options for comparing outputs
 */
export interface CompareOptions {
  compareStderr?: boolean;
  compareExitCode?: boolean;
  normalizeWhitespace?: boolean;
}

/**
 * Sets up test files in both real FS and creates a BashEnv
 */
export async function setupFiles(
  testDir: string,
  files: Record<string, string>,
): Promise<Bash> {
  // Store files in registry for compareOutputs to access
  setupFilesRegistry.set(testDir, files);

  // Create files in real FS (needed for tests that use runRealBash directly)
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(testDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  // Create equivalent BashEnv with normalized paths
  // @banned-pattern-ignore: path.join() produces full paths like "/tmp/test/file", never "__proto__"
  const bashEnvFiles: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(files)) {
    bashEnvFiles[path.join(testDir, filePath)] = content;
  }

  return new Bash({
    files: bashEnvFiles,
    cwd: testDir,
  });
}

/**
 * Runs a command in real bash
 */
export async function runRealBash(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      shell: "/bin/bash",
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.code || 1,
    };
  }
}

/**
 * Normalizes whitespace in output for comparison.
 * Useful for commands like `wc` where BSD and GNU have different column widths.
 */
function normalizeWhitespace(str: string): string {
  return str
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n");
}

/**
 * Convert file:// URL to path
 */
function fileUrlToPath(url: string): string {
  if (!url) return "";
  if (url.startsWith("file://")) {
    return url.slice(7);
  }
  return url;
}

/**
 * Get the calling test file path from the stack trace
 * Works with both vitest and regular Node.js stack traces
 */
function getCallingTestFile(): string {
  const err = new Error();
  const stack = err.stack || "";
  const lines = stack.split("\n");

  // Look for comparison test file patterns in stack trace
  // Stack traces can have formats like:
  // - "at func (file:///path/to/file.ts:line:col)"
  // - "at func (/path/to/file.ts:line:col)"
  // - "at file:///path/to/file.ts:line:col"
  for (const line of lines) {
    // Match file:// URLs
    let match = line.match(/file:\/\/([^):]+\.comparison\.test\.ts)/);
    if (match) {
      return match[1];
    }
    // Match regular paths in parentheses
    match = line.match(/\(([^):]+\.comparison\.test\.ts)/);
    if (match) {
      return match[1];
    }
    // Match paths without parentheses (at path:line:col)
    match = line.match(/at\s+([^():]+\.comparison\.test\.ts)/);
    if (match) {
      return match[1].trim();
    }
  }

  // If no comparison test found, fall back to any test file
  for (const line of lines) {
    let match = line.match(/file:\/\/([^):]+\.test\.ts)/);
    if (match) {
      return match[1];
    }
    match = line.match(/\(([^):]+\.test\.ts)/);
    if (match) {
      return match[1];
    }
  }

  throw new Error(
    `Could not determine calling test file from stack trace:\n${stack}`,
  );
}

/**
 * Internal comparison function that takes all parameters explicitly
 */
async function compareOutputsInternal(
  env: Bash,
  testDir: string,
  command: string,
  files: Record<string, string>,
  testFile: string,
  options?: CompareOptions,
): Promise<void> {
  // Run BashEnv
  const bashEnvResult = await env.exec(command);

  const fixtureId = generateFixtureId(command, files);

  let realBashStdout: string;
  let realBashStderr: string;
  let realBashExitCode: number;

  if (isRecordMode) {
    // Check if fixture is locked - if so, use existing fixture values
    const existingFixtures = await loadFixtures(testFile);
    const existingFixture = existingFixtures[fixtureId];

    if (existingFixture?.locked && !isForceRecordMode) {
      // Use locked fixture values, don't run real bash
      realBashStdout = existingFixture.stdout;
      realBashStderr = existingFixture.stderr;
      realBashExitCode = existingFixture.exitCode;
      skippedLockedFixtures.push({ testFile, fixtureId, command });
    } else {
      // Run real bash and save to fixtures
      const realBashResult = await runRealBash(command, testDir);
      realBashStdout = realBashResult.stdout;
      realBashStderr = realBashResult.stderr;
      realBashExitCode = realBashResult.exitCode;

      await recordFixture(testFile, fixtureId, {
        command,
        files,
        stdout: realBashStdout,
        stderr: realBashStderr,
        exitCode: realBashExitCode,
      });
    }
  } else {
    // In playback mode, load from fixtures
    const fixtures = await loadFixtures(testFile);
    const fixture = fixtures[fixtureId];

    if (!fixture) {
      throw new Error(
        `No fixture found for command "${command}" with files ${JSON.stringify(files)}.\n` +
          `Fixture ID: ${fixtureId}\n` +
          `Run with RECORD_FIXTURES=1 to record fixtures.`,
      );
    }

    realBashStdout = fixture.stdout;
    realBashStderr = fixture.stderr;
    realBashExitCode = fixture.exitCode;
  }

  let bashEnvStdout = bashEnvResult.stdout;
  let expectedStdout = realBashStdout;

  if (options?.normalizeWhitespace) {
    bashEnvStdout = normalizeWhitespace(bashEnvStdout);
    expectedStdout = normalizeWhitespace(expectedStdout);
  }

  if (bashEnvStdout !== expectedStdout) {
    throw new Error(
      `stdout mismatch for "${command}"\n` +
        `Expected (recorded bash): ${JSON.stringify(realBashStdout)}\n` +
        `Received (BashEnv):       ${JSON.stringify(bashEnvResult.stdout)}`,
    );
  }

  if (options?.compareExitCode !== false) {
    if (bashEnvResult.exitCode !== realBashExitCode) {
      throw new Error(
        `exitCode mismatch for "${command}"\n` +
          `Expected (recorded bash): ${realBashExitCode}\n` +
          `Received (BashEnv):       ${bashEnvResult.exitCode}`,
      );
    }
  }
}

/**
 * Compares BashEnv output with recorded bash output (from fixtures)
 * In record mode, runs real bash and saves the output to fixtures
 *
 * @param env - BashEnv instance
 * @param testDir - Test directory path
 * @param command - Command to run
 * @param options - Comparison options (optional)
 * @param files - Files that were set up (optional, auto-retrieved from setupFiles registry)
 * @param testFileUrl - import.meta.url of the test file (optional, falls back to stack trace)
 */
export async function compareOutputs(
  env: Bash,
  testDir: string,
  command: string,
  options?: CompareOptions,
  files?: Record<string, string>,
  testFileUrl?: string,
): Promise<void> {
  const testFile = testFileUrl
    ? fileUrlToPath(testFileUrl)
    : getCallingTestFile();
  // Get files from registry if not provided
  const testFiles = files || setupFilesRegistry.get(testDir) || {};
  return compareOutputsInternal(
    env,
    testDir,
    command,
    testFiles,
    testFile,
    options,
  );
}

export { path, fs };
