import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

const FILES = {
  "data.txt": "secret\n",
  "secret.sh": "echo hidden\n",
};

describe("file permissions - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("denies cat reads without owner read permission", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 000 data.txt; cat data.txt; echo "rc=$?"',
    );
  });

  it("denies input redirection without owner read permission", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 000 data.txt; cat < data.txt; echo "rc=$?"',
    );
  });

  it("denies bash script reads without owner read permission", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 000 secret.sh; bash secret.sh; echo "rc=$?"',
    );
  });

  it("denies source reads without owner read permission", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 000 secret.sh; source secret.sh; echo "rc=$?"',
    );
  });

  it("preserves content when truncate permission is denied", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 444 data.txt; echo x > data.txt; cat data.txt; echo "rc=$?"',
    );
  });

  it("preserves content when append permission is denied", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 444 data.txt; echo x >> data.txt; cat data.txt; echo "rc=$?"',
    );
  });

  it("restores access when owner permissions are restored", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 000 data.txt; chmod 644 data.txt; cat data.txt; echo "rc=$?"',
    );
  });
});
