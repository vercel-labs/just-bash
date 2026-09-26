import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq structural array subtraction", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  it.each([
    ['{"arr":[{"a":1,"b":2}]}', '.arr -= [{"b":2,"a":1}]', '{"arr":[]}'],
    [
      '[{"a":[{"x":1,"y":2}],"b":0}, {"b":0,"a":[{"y":2,"x":1}]}]',
      '. - [{"b":0,"a":[{"y":2,"x":1}]}]',
      "[]",
    ],
    ["[[1,2],[2,1],[1,2]]", ". - [[1,2]]", "[[2,1]]"],
    ['[1,"1",true,false,null,{},[]]', ". - [1,true,{},[]]", '["1",false,null]'],
    ['[{"a":1},{"b":1},{"a":2}]', '. - [{"b":1}]', '[{"a":1},{"a":2}]'],
    [
      '[{"toString":1,"valueOf":2,"hasOwnProperty":3}]',
      '. - [{"hasOwnProperty":3,"valueOf":2,"toString":1}]',
      "[]",
    ],
    ['[{"é":1},{"é":1}]', '. - [{"é":1}]', '[{"é":1}]'],
    ["null", "[nan] - [null]", "[null]"],
    ["null", "[nan] - [nan]", "[null]"],
  ])("%s | %s", async (input, filter) => {
    const env = await setupFiles(testDir, { "input.json": input });
    await compareOutputs(env, testDir, `jq -c '${filter}' input.json`);
  });
});
