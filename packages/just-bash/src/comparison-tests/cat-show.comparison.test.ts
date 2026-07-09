import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// GNU coreutils `cat` display flags (-A -b -e -E -s -t -T -v -u).
// macOS ships BSD `cat`, which lacks -A/-E/-T/long options and diverges on
// -v notation, so these fixtures are recorded against GNU cat and locked.
const BASIC = "line 1\nline 2\nline 3\n";
const BLANKS = "a\n\n\n\nb\n\n\nc\n";
const TABS = "col1\tcol2\tcol3\n";
const CTRL = "bell\x07end\nesc\x1bhere\ndel\x7fmark\n";
const MIXED = "tab\there\nctrl\x07bell\ndel\x7fdel\n";
const NOTRAIL = "tab\there no newline";

describe("cat display flags - GNU Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should match -A (show-all)", async () => {
    const env = await setupFiles(testDir, { "mixed.txt": MIXED });
    await compareOutputs(env, testDir, "cat -A mixed.txt");
  });

  it("should match -A on file without trailing newline", async () => {
    const env = await setupFiles(testDir, { "notrail.txt": NOTRAIL });
    await compareOutputs(env, testDir, "cat -A notrail.txt");
  });

  it("should match -b (number-nonblank)", async () => {
    const env = await setupFiles(testDir, { "blanks.txt": BLANKS });
    await compareOutputs(env, testDir, "cat -b blanks.txt");
  });

  it("should match -e (== -vE)", async () => {
    const env = await setupFiles(testDir, { "mixed.txt": MIXED });
    await compareOutputs(env, testDir, "cat -e mixed.txt");
  });

  it("should match -E (show-ends)", async () => {
    const env = await setupFiles(testDir, { "basic.txt": BASIC });
    await compareOutputs(env, testDir, "cat -E basic.txt");
  });

  it("should match -E on file without trailing newline", async () => {
    const env = await setupFiles(testDir, { "notrail.txt": NOTRAIL });
    await compareOutputs(env, testDir, "cat -E notrail.txt");
  });

  it("should match -s (squeeze-blank)", async () => {
    const env = await setupFiles(testDir, { "blanks.txt": BLANKS });
    await compareOutputs(env, testDir, "cat -s blanks.txt");
  });

  it("should match -t (== -vT)", async () => {
    const env = await setupFiles(testDir, { "tabs.txt": TABS });
    await compareOutputs(env, testDir, "cat -t tabs.txt");
  });

  it("should match -T (show-tabs)", async () => {
    const env = await setupFiles(testDir, { "tabs.txt": TABS });
    await compareOutputs(env, testDir, "cat -T tabs.txt");
  });

  it("should match -v (show-nonprinting)", async () => {
    const env = await setupFiles(testDir, { "ctrl.txt": CTRL });
    await compareOutputs(env, testDir, "cat -v ctrl.txt");
  });

  it("should match -u (ignored no-op)", async () => {
    const env = await setupFiles(testDir, { "basic.txt": BASIC });
    await compareOutputs(env, testDir, "cat -u basic.txt");
  });
});

describe("cat combined flags - GNU Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should match -An (show-all + number)", async () => {
    const env = await setupFiles(testDir, { "mixed.txt": MIXED });
    await compareOutputs(env, testDir, "cat -An mixed.txt");
  });

  it("should match -bE (number-nonblank + show-ends)", async () => {
    const env = await setupFiles(testDir, { "blanks.txt": BLANKS });
    await compareOutputs(env, testDir, "cat -bE blanks.txt");
  });

  it("should match -vET (== -A)", async () => {
    const env = await setupFiles(testDir, { "mixed.txt": MIXED });
    await compareOutputs(env, testDir, "cat -vET mixed.txt");
  });

  it("should match -nb (-b overrides -n)", async () => {
    const env = await setupFiles(testDir, { "blanks.txt": BLANKS });
    await compareOutputs(env, testDir, "cat -nb blanks.txt");
  });

  it("should match -sn (squeeze + number)", async () => {
    const env = await setupFiles(testDir, { "blanks.txt": BLANKS });
    await compareOutputs(env, testDir, "cat -sn blanks.txt");
  });
});

describe("cat long options - GNU Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("should match --show-all", async () => {
    const env = await setupFiles(testDir, { "mixed.txt": MIXED });
    await compareOutputs(env, testDir, "cat --show-all mixed.txt");
  });

  it("should match --number-nonblank", async () => {
    const env = await setupFiles(testDir, { "blanks.txt": BLANKS });
    await compareOutputs(env, testDir, "cat --number-nonblank blanks.txt");
  });

  it("should match --show-ends", async () => {
    const env = await setupFiles(testDir, { "basic.txt": BASIC });
    await compareOutputs(env, testDir, "cat --show-ends basic.txt");
  });

  it("should match --squeeze-blank", async () => {
    const env = await setupFiles(testDir, { "blanks.txt": BLANKS });
    await compareOutputs(env, testDir, "cat --squeeze-blank blanks.txt");
  });

  it("should match --show-tabs", async () => {
    const env = await setupFiles(testDir, { "tabs.txt": TABS });
    await compareOutputs(env, testDir, "cat --show-tabs tabs.txt");
  });

  it("should match --show-nonprinting", async () => {
    const env = await setupFiles(testDir, { "ctrl.txt": CTRL });
    await compareOutputs(env, testDir, "cat --show-nonprinting ctrl.txt");
  });
});
