import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq arithmetic assignment", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    ['{"value":[1,2]}', "try (.value -= 1) catch ."],
    ['{"value":{"a":1}}', "try (.value /= 2) catch ."],
    ['{"value":"a"}', "try (.value %= 3) catch ."],
    ['{"value":4}', 'try (.value += "x") catch .'],
    ['{"value":[]}', "try (.value *= true) catch ."],
    ['{"value":2}', '.value *= "ab"'],
    ['{"value":"ab"}', ".value *= -1"],
    ["{}", '.arr += ["a"]'],
    ['{"arr":["a","b","c"]}', '.arr -= ["b"]'],
    ['{"arr":["b","a","b","c"]}', '.arr -= ["b"]'],
    ['{"arr":[1,"1",null,[1],{"x":1}]}', '.arr -= [1,null,[1],{"x":1}]'],
    ['{"arr":[1,2,3],"remove":[2]}', ".arr -= .remove"],
    ['{"arr":[1,2]}', ".arr -= []"],
    ['{"n":8}', ".n -= 3"],
    ['{"value":[1]}', ".value += null"],
    ['{"value":"ab"}', ".value *= 3"],
    ['{"value":{"a":{"b":1}}}', '.value *= {"a":{"c":2}}'],
    ['{"value":"a,b,c"}', '.value /= ","'],
    ['{"value":8}', ".value %= 3"],
  ])("%s | %s", async (input, filter) => {
    const env = await setupFiles(testDir, { "input.json": input });
    await compareOutputs(env, testDir, `jq -c '${filter}' input.json`);
  });
});
