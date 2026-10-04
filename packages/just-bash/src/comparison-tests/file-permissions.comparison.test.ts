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

  it("reports GNU's diagnostic for copying an unreadable source", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 000 data.txt; cp data.txt copy.txt; echo "rc=$?"',
    );
  });

  it("reports GNU's diagnostic for copying over a read-only destination", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 444 data.txt; cp secret.sh data.txt; echo "rc=$?"; cat data.txt',
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

  it("moves unreadable files over read-only files and preserves their mode", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      'chmod 000 secret.sh; chmod 444 data.txt; mv secret.sh data.txt; echo "rc=$?"; stat -c %a data.txt; chmod 644 data.txt; cat data.txt',
    );
  });

  it("edits read-only files in place while preserving their mode", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      `chmod 444 data.txt; sed -i 's/secret/updated/' data.txt; echo "rc=$?"; stat -c %a data.txt; cat data.txt`,
    );
  });

  it("replaces a symlink itself during sed -i", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      `ln -s data.txt link.txt; sed -i 's/secret/updated/' link.txt; test -L link.txt; echo "link=$?"; cat link.txt; cat data.txt`,
    );
  });

  it("reports sed read permission failures with GNU's diagnostic", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      `chmod 000 data.txt; sed 's/secret/updated/' data.txt; echo "rc=$?"`,
    );
  });

  it("checks write permission for read-write redirection", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      `chmod 400 data.txt; exec 3<> data.txt; echo "rc=$?"`,
    );
  });

  it("preserves mode when redirecting over an existing file", async () => {
    const env = await setupFiles(testDir, FILES);
    await compareOutputs(
      env,
      testDir,
      `echo x > m; chmod 600 m; echo y > m; stat -c %a m; cat m`,
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
