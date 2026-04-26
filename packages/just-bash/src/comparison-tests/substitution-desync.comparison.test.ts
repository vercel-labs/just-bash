import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  runRealBash,
  setupFiles,
} from "./fixture-runner.js";

describe("substitution boundary desync - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it("keeps arithmetic-command-sub payload text as data (dollar-paren)", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'rm -f marker; ( echo $(( $(printf "%s\\n" ") ; echo DESYNC > marker ; #") + 1 )) >/dev/null ) 2>/dev/null || true; if [ -f marker ]; then echo MARKER_PRESENT; else echo MARKER_ABSENT; fi',
    );
  });

  it("keeps arithmetic-command-sub payload text as data (backticks)", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      'rm -f marker; ( echo $(( `printf "%s\\n" ") ; echo DESYNC > marker ; #"` + 1 )) >/dev/null ) 2>/dev/null || true; if [ -f marker ]; then echo MARKER_PRESENT; else echo MARKER_ABSENT; fi',
    );
  });

  it("does not execute marker write from comment-like substitution boundary confusion", async () => {
    const env = await setupFiles(testDir, {});
    const payload =
      'rm -f marker; ( echo "$(echo SAFE #) ; echo DESYNC > marker )" >/dev/null ) 2>/dev/null || true';

    await env.exec(payload);
    const virtualCheck = await env.exec(
      "if [ -f marker ]; then echo MARKER_PRESENT; else echo MARKER_ABSENT; fi",
    );

    await runRealBash(payload, testDir);
    const realCheck = await runRealBash(
      "if [ -f marker ]; then echo MARKER_PRESENT; else echo MARKER_ABSENT; fi",
      testDir,
    );

    if (virtualCheck.stdout !== realCheck.stdout) {
      throw new Error(
        `marker-state mismatch for comment-like boundary probe\n` +
          `Expected (real bash): ${JSON.stringify(realCheck.stdout)}\n` +
          `Received (BashEnv):  ${JSON.stringify(virtualCheck.stdout)}`,
      );
    }
  });

  it("treats $(( (cmd) || (cmd2) )) as arithmetic context", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "rm -f marker; ( echo $(( (echo LEFT; echo DESYNC > marker) || (echo RIGHT) )) >/dev/null ) 2>/dev/null || true; if [ -f marker ]; then echo MARKER_PRESENT; else echo MARKER_ABSENT; fi",
    );
  });

  it("distinguishes $( (cmd) || (cmd2) ) command substitution control case", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "rm -f marker; echo $( (echo LEFT; echo DESYNC > marker) || (echo RIGHT) ) >/dev/null; if [ -f marker ]; then echo MARKER_PRESENT; else echo MARKER_ABSENT; fi",
    );
  });

  it("keeps $((cmd)redirection) parsed as command substitution form", async () => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(
      env,
      testDir,
      "echo $((echo AA; false || echo BB)2>/dev/null)",
    );
  });
});
