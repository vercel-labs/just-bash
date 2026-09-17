import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

// Record with GNU coreutils on PATH. Check the shape, location, type and mode
// of generated entries instead of recording their random names. Every created
// entry stays beneath testDir and is removed by cleanupTestDir.
describe("mktemp - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("creates a private empty file using TMPDIR and the default template", async () => {
    const env = await setupFiles(testDir, { "work/.keep": "" });
    await compareOutputs(
      env,
      testDir,
      String.raw`
      file=$(TMPDIR=work mktemp) &&
      [[ "$file" =~ ^work/tmp\.[0-9A-Za-z]{10}$ ]] &&
      test -f "$file" && stat -c '%a %s' "$file"
    `,
    );
  });

  it("prints a bare template relative to the current directory", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      String.raw`
      file=$(mktemp note.XXXXXX) &&
      [[ "$file" =~ ^note\.[0-9A-Za-z]{6}$ ]] &&
      test -f "$file" && echo relative
    `,
    );
  });

  it("creates a private directory with a clustered -dp and separate value", async () => {
    const env = await setupFiles(testDir, { "work/.keep": "" });
    await compareOutputs(
      env,
      testDir,
      String.raw`
      dir=$(mktemp -dp work) &&
      [[ "$dir" =~ ^work/tmp\.[0-9A-Za-z]{10}$ ]] &&
      stat -c '%F %a' "$dir"
    `,
    );
  });

  it.each([
    "--tmpdir=",
    "-p ''",
  ])("uses TMPDIR for an empty directory option: %s", async (option) => {
    const env = await setupFiles(testDir, { "work/.keep": "" });
    await compareOutputs(
      env,
      testDir,
      String.raw`
        file=$(TMPDIR=work mktemp ${option}) &&
        [[ "$file" =~ ^work/tmp\.[0-9A-Za-z]{10}$ ]] &&
        test -f "$file" && echo created
      `,
    );
  });

  it.each([
    "note.XXXXXX.txt",
    "--suffix=.txt note.XXXXXX",
  ])("supports suffixes: %s", async (args) => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      String.raw`
        file=$(mktemp ${args}) &&
        [[ "$file" =~ ^note\.[0-9A-Za-z]{6}\.txt$ ]] &&
        test -f "$file" && echo suffix
      `,
    );
  });

  it("resolves nested templates under -p", async () => {
    const env = await setupFiles(testDir, { "work/sub/.keep": "" });
    await compareOutputs(
      env,
      testDir,
      String.raw`
      file=$(mktemp -p work sub/note.XXXXXX) &&
      [[ "$file" =~ ^work/sub/note\.[0-9A-Za-z]{6}$ ]] &&
      test -f "$file" && echo nested
    `,
    );
  });

  it("preserves earlier X runs", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      String.raw`
      file=$(mktemp XXXX.log.XXXX) &&
      [[ "$file" =~ ^XXXX\.log\.[0-9A-Za-z]{4}$ ]] &&
      test -f "$file" && echo preserved
    `,
    );
  });

  it("does not create a file or parent directory in dry-run mode", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      String.raw`
      file=$(mktemp -u -p missing note.XXXXXX) &&
      [[ "$file" =~ ^missing/note\.[0-9A-Za-z]{6}$ ]] &&
      test ! -e "$file" && test ! -e missing && echo absent
    `,
    );
  });

  it("suppresses creation errors but still fails for a missing parent", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, "mktemp -q -p missing 2>&1");
  });

  it("does not suppress invalid-template diagnostics under -q", async () => {
    const env = await setupFiles(testDir, {});
    // GNU localizes diagnostic quotes; keep record mode stable across locales.
    await compareOutputs(env, testDir, "LC_ALL=C mktemp -q bad.XX 2>&1");
  });
});
