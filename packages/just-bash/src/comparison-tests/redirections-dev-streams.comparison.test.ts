import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

const both = "{ echo out; echo err >&2; }";

// The recorder's bash inherits sockets on fd 1 and 2, and opening /dev/stdout
// on a socket fails with ENXIO, so every case first points the stream at a
// pipe or a file.
describe("&> to /dev/stdout and /dev/stderr - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    `${both} &> /dev/stdout | tr a-z A-Z`,
    "cat /nope &>> /dev/stdout | tr a-z A-Z",
    `{ ${both} &> /dev/stderr; } 2> e; echo rc=$?; cat e`,
    "{ echo g &>> /dev/stderr; } 2> e; cat e",
    `${both} > f &> /dev/stdout; echo rc=$?; cat f`,
    `${both} 2>/dev/null &> /dev/stderr; echo after`,
    "{ echo x > /dev/./stderr; } 2> e; cat e",
    `${both} &> reg; cat reg`,
  ])("%s", async (script) => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, script);
  });
});
