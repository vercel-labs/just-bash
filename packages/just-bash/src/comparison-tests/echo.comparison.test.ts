import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("echo command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should match simple string", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo hello");
  });

  it("should match double-quoted string", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'echo "hello world"');
  });

  it("should match single-quoted string", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo 'single quotes'");
  });

  it("should match -n flag (no newline)", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo -n hello");
  });

  it("should match multiple arguments", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo one two three");
  });

  it("should match empty echo", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "echo");
  });

  it("should match echo with special characters", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'echo "hello * world"');
  });

  it("should match echo with escaped quotes", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'echo "say \\"hello\\""');
  });

  it("should match -e flag with newline", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'echo -e "line1\\nline2"');
  });

  it("should match -e flag with tab", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, 'echo -e "col1\\tcol2"');
  });
});
