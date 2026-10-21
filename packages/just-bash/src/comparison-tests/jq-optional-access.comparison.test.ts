import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq postfix optional access", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    ['[{"x":1},4,{"x":2}]', "[.[].x?]"],
    ['{"a":[1,{"b":2}]}', "[.a[].b?]"],
    ['{"a":[{"b":1},"x"]}', "[.a[]?.b?]"],
    ['[[1,2],"s",[3]]', "[.[][1:]?]"],
    ["[[1],null,[2]]", "[.[][]?]"],
    ['[1,{"a":1}]', "[.[] | .a?]"],
    ['{"a":1}', "[.a.b?]"],
    ["1", "[.a?.b]"],
    ["1", "try [.a.b?] catch ."],
    ['{"i":"y","a":{"i":"x","x":1,"y":2}}', "[.a[.i]?]"],
    ['{"a":[1,2,3,4],"s":1,"e":3}', "[.a[.s:.e]?]"],
    ["[1,2]", 'try [.[error("x")]?] catch .'],
    ["[[1,2],[3]]", 'try [.[error("x"):]?] catch .'],
    ["[[1,2],[3]]", 'try [(.[0], error("y"))[error("x")]?] catch .'],
  ])("%s | %s", async (input, filter) => {
    const env = await setupFiles(testDir, { "input.json": input });
    await compareOutputs(env, testDir, `jq -c '${filter}' input.json`);
  });
});
