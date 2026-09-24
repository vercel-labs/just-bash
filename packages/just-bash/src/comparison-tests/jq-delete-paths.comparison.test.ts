import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq filtered deletion and paths", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    ['{"arr":["a","b","c"]}', 'del(.arr[] | select(. == "b"))'],
    ['{"arr":["b","a","b","b","c","b"]}', 'del(.arr[] | select(. == "b"))'],
    ['{"arr":["a","b"]}', 'del(.arr[] | select(. == "missing"))'],
    ['{"arr":["b","b"]}', 'del(.arr[] | select(. == "b"))'],
    ['{"arr":[]}', 'del(.arr[] | select(. == "b"))'],
    ['{"arr":["a","b","c"]}', '[path(.arr[] | select(. == "b"))]'],
    ['{"arr":["a","b","c"]}', "[path(.arr[])]"],
    [
      '{"arr":[{"drop":true,"v":1},{"drop":false,"v":2},{"drop":true,"v":3}]}',
      "del(.arr[] | select(.drop) | .v)",
    ],
    [
      '{"arr":[{"drop":true,"v":1},{"drop":false,"v":2}]}',
      "[path(.arr[] | select(.drop) | .v)]",
    ],
    ['{"a":[[1,2,3],[2,2],[3]]}', "del(.a[][] | select(. == 2))"],
    ['{"a":{"x":1,"y":2,"z":2}}', "del(.a[] | select(. == 2))"],
    ['{"a":[{"x":1},{"x":2}]}', "del(.a[].x)"],
    ['{"arr":["a","b","c","d"]}', "del(.arr[0], .arr[2])"],
    ['{"arr":["a","b","c","d"]}', "del(.arr[1], .arr[1], .arr[-3])"],
    ['{"arr":[{"x":1},{"x":2},{"x":3}]}', "del(.arr[0], .arr[1].x)"],
    ['{"arr":[{"x":1},{"x":2}]}', "del(.arr[-1].x)"],
    ['{"arr":[1,2]}', "del(.arr[-99], .arr[99])"],
    ['{"arr":[1,2]}', "del(.arr[])"],
    ['{"arr":[1,2]}', "del(.arr, .arr[0])"],
    ['{"arr":[1,2]}', "del(empty)"],
    ['{"arr":[1,2]}', "del(.)"],
    ['{"arr":[1,2]}', "del(.missing.child)"],
    ['{"arr":[1,2]}', "del(.arr[0,1])"],
    ['{"arr":[1,2]}', "[path(.arr[0,1])]"],
    ['{"arr":null}', "del(.arr[]?)"],
    ['{"arr":[{"x":1},{"x":2}]}', "del(.arr[-1] | .x)"],
    ['{"arr":[1,2]}', "del((.arr[], .arr[]) | select(. == 1))"],
    ['{"arr":[1,2]}', "[path((.arr[], .arr[]) | select(. == 1))]"],
    [
      '{"arr":[1,2]}',
      "[path(.arr[] | select(. == 1)), path(.arr[] | select(. == 9))]",
    ],
  ])("%s | %s", async (input, filter) => {
    const env = await setupFiles(testDir, { "input.json": input });
    await compareOutputs(env, testDir, `jq -c '${filter}' input.json`);
  });
});
