import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("positional default assignment - GNU Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  it.each([
    'echo "${1:=fallback}"',
    'echo "prefix${12=fallback}"',
    'defaults=(one two); echo "${1:=${defaults[@]}}"',
    "echo ${@:=fallback}",
  ])("rejects %s", async (command) => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `(set -e; set --; ${command}) 2>/dev/null`,
    );
  });

  it("keeps set positional parameters and ordinary assignment defaults working", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      `set -eu
set -- value ''
printf '<%s>\\n' "\${1:=ignored}" "\${2=ignored}"
unset fallback
printf '<%s>\\n' "\${fallback:=assigned}" "$fallback"`,
    );
  });
});
