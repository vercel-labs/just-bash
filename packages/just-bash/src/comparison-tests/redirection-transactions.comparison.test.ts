import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("redirection transactions - Real Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  it("applies redirects introduced by alias expansion", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "shopt -s expand_aliases; alias routed=': >alias.txt'; eval routed; echo after; test -f alias.txt && echo exists; test ! -s alias.txt && echo empty",
    );
  });

  it("selects exec policy from an expanded command name", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "exec 3>&1; runner=exec; $runner >out.txt; echo after; cat out.txt >&3",
    );
  });

  it("persists stdout and stderr for exec >&file", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "exec >&all.txt; printf out; printf err >&2",
    );
  });

  it("binds fd1 and fd2 heredocs independently from stdin", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'read -u 1 one 1<<EOF\nfirst\nEOF\nread -u 2 two 2<<EOF\nsecond\nEOF\nprintf \'%s:%s\' "$one" "$two"',
    );
  });

  it("routes function return output through definition redirects", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'fn() { printf before; printf problem >&2; return 4; } >out.txt 2>err.txt; fn; printf \'rc=%s out=%s err=%s\' "$?" "$(cat out.txt)" "$(cat err.txt)"',
    );
  });

  it("keeps truncation when the redirected command fails", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "printf previous >out.txt; false >out.txt; wc -c <out.txt",
    );
  });

  it("opens multiple output targets in source order", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "printf data >first.txt >second.txt; wc -c <first.txt; cat second.txt",
    );
  });

  it("keeps a duplicated output description alive until its last descriptor closes", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "exec 3>out.txt; exec 4>&3; exec 3>&-; printf data >&4; exec 4>&-; cat out.txt",
    );
  });

  it("rejects output written through an fd1 heredoc", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(env, testDirectory, "echo hi 1<<EOF\nvalue\nEOF");
  });

  it("suppresses diagnostics written through an fd2 heredoc", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      "nosuchcommand 2<<EOF\nvalue\nEOF",
    );
  });
});
