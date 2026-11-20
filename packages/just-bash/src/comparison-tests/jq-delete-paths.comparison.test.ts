import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq deletion paths - Real Bash Comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    ['{"a":1,"b":2,"c":3}', "del(.a,.b)"],
    ["[0,1,2,3]", "del(.[0],.[-2],.[0])"],
    ['{"a":null,"b":[null,1,null],"c":{"d":null,"e":2}}', "del(..|nulls)"],
    ['{"items":[1,2,3,4]}', "del(.items[]|select(.>1))"],
  ])("selects original locations in %s with %s", async (input, filter) => {
    const env = await setupFiles(testDir, { "input.json": input });
    await compareOutputs(env, testDir, `jq -c '${filter}' input.json`);
  });
});
