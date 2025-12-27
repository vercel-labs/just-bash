import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { Bash } from "../Bash.js";

export const execAsync: (
  command: string,
  options?: { cwd?: string; shell?: string },
) => Promise<{ stdout: string; stderr: string }> = promisify(exec);

/**
 * Returns true if running on Linux (for platform-specific tests)
 * Some behaviors differ between macOS/BSD and Linux/GNU coreutils
 */
export const isLinux: boolean = os.platform() === "linux";

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
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Sets up test files in both real FS and creates a BashEnv
 */
export async function setupFiles(
  testDir: string,
  files: Record<string, string>,
): Promise<Bash> {
  // Create files in real FS
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(testDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  // Create equivalent BashEnv with normalized paths
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
 * Compares BashEnv output with real bash output
 */
export async function compareOutputs(
  env: Bash,
  testDir: string,
  command: string,
  options?: {
    compareStderr?: boolean;
    compareExitCode?: boolean;
    normalizeWhitespace?: boolean;
  },
): Promise<void> {
  const [bashEnvResult, realBashResult] = await Promise.all([
    env.exec(command),
    runRealBash(command, testDir),
  ]);

  let bashEnvStdout = bashEnvResult.stdout;
  let realBashStdout = realBashResult.stdout;

  if (options?.normalizeWhitespace) {
    bashEnvStdout = normalizeWhitespace(bashEnvStdout);
    realBashStdout = normalizeWhitespace(realBashStdout);
  }

  if (bashEnvStdout !== realBashStdout) {
    throw new Error(
      `stdout mismatch for "${command}"\n` +
        `Expected (real bash): ${JSON.stringify(realBashResult.stdout)}\n` +
        `Received (BashEnv):   ${JSON.stringify(bashEnvResult.stdout)}`,
    );
  }

  if (options?.compareExitCode !== false) {
    if (bashEnvResult.exitCode !== realBashResult.exitCode) {
      throw new Error(
        `exitCode mismatch for "${command}"\n` +
          `Expected (real bash): ${realBashResult.exitCode}\n` +
          `Received (BashEnv):   ${bashEnvResult.exitCode}`,
      );
    }
  }
}

export { path, fs };
