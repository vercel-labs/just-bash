import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq command - Real Bash Comparison", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  describe("identity filter", () => {
    it("should pass through JSON with .", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"a":1,"b":2}',
      });
      await compareOutputs(env, testDir, "jq '.' data.json");
    });

    it("should pretty print arrays", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[1,2,3]",
      });
      await compareOutputs(env, testDir, "jq '.' data.json");
    });
  });

  describe("object access", () => {
    it("should access object key with .key", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"name":"test","value":42}',
      });
      await compareOutputs(env, testDir, "jq '.name' data.json");
    });

    it("should access nested key with .a.b", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"a":{"b":"nested"}}',
      });
      await compareOutputs(env, testDir, "jq '.a.b' data.json");
    });

    it("should return null for missing key", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"a":1}',
      });
      await compareOutputs(env, testDir, "jq '.missing' data.json");
    });
  });

  describe("array access", () => {
    it("should access array element with .[0]", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '["a","b","c"]',
      });
      await compareOutputs(env, testDir, "jq '.[0]' data.json");
    });

    it("should access last element with .[-1]", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '["a","b","c"]',
      });
      await compareOutputs(env, testDir, "jq '.[-1]' data.json");
    });
  });

  describe("array iteration", () => {
    it("should iterate array with .[]", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[1,2,3]",
      });
      await compareOutputs(env, testDir, "jq '.[]' data.json");
    });

    it("should iterate object values with .[]", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"a":1,"b":2}',
      });
      await compareOutputs(env, testDir, "jq '.[]' data.json");
    });
  });

  describe("pipes", () => {
    it("should pipe filters with |", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"data":{"value":42}}',
      });
      await compareOutputs(env, testDir, "jq '.data | .value' data.json");
    });
  });

  describe("compact output (-c)", () => {
    it("should output compact JSON with -c", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"a":1,"b":2}',
      });
      await compareOutputs(env, testDir, "jq -c '.' data.json");
    });
  });

  describe("raw output (-r)", () => {
    it("should output strings without quotes with -r", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"name":"test"}',
      });
      await compareOutputs(env, testDir, "jq -r '.name' data.json");
    });
  });

  describe("null input (-n)", () => {
    it("should work with null input", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -n 'null'");
    });

    it("should generate range with null input", async () => {
      const env = await setupFiles(testDir, {});
      await compareOutputs(env, testDir, "jq -n '[range(5)]'");
    });
  });

  describe("slurp (-s)", () => {
    it("should slurp multiple JSON lines into array", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "1\n2\n3",
      });
      await compareOutputs(env, testDir, "jq -s '.' data.json");
    });
  });

  describe("builtin functions", () => {
    it("should get keys", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"b":1,"a":2}',
      });
      await compareOutputs(env, testDir, "jq 'keys' data.json");
    });

    it("should get length of array", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[1,2,3,4,5]",
      });
      await compareOutputs(env, testDir, "jq 'length' data.json");
    });

    it("should get type", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"a":1}',
      });
      await compareOutputs(env, testDir, "jq 'type' data.json");
    });

    it("should sort array", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[3,1,2]",
      });
      await compareOutputs(env, testDir, "jq 'sort' data.json");
    });

    it("should reverse array", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[1,2,3]",
      });
      await compareOutputs(env, testDir, "jq 'reverse' data.json");
    });

    it("should add array", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[1,2,3,4]",
      });
      await compareOutputs(env, testDir, "jq 'add' data.json");
    });
  });

  describe("select and map", () => {
    it("should filter with select", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[1,2,3,4,5]",
      });
      await compareOutputs(
        env,
        testDir,
        "jq '[.[] | select(. > 3)]' data.json",
      );
    });

    it("should transform with map", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "[1,2,3]",
      });
      await compareOutputs(env, testDir, "jq 'map(. * 2)' data.json");
    });
  });

  describe("arithmetic", () => {
    it("should add numbers", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "5",
      });
      await compareOutputs(env, testDir, "jq '. + 3' data.json");
    });

    it("should multiply numbers", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "6",
      });
      await compareOutputs(env, testDir, "jq '. * 7' data.json");
    });
  });

  describe("conditionals", () => {
    it("should evaluate if-then-else", async () => {
      const env = await setupFiles(testDir, {
        "data.json": "5",
      });
      await compareOutputs(
        env,
        testDir,
        'jq \'if . > 3 then "big" else "small" end\' data.json',
      );
    });
  });

  describe("object construction with string key shorthand", () => {
    it('should handle {"name"} shorthand', async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"name":"foo","extra":"bar"}',
      });
      await compareOutputs(env, testDir, `jq -c '{"name"}' data.json`);
    });

    it('should handle {"name", "label"} shorthand', async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"name":"foo","label":"bar","extra":"baz"}',
      });
      await compareOutputs(env, testDir, `jq -c '{"name", "label"}' data.json`);
    });

    it('should handle {"if"} keyword string shorthand', async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"if":"val"}',
      });
      await compareOutputs(env, testDir, `jq -c '{"if"}' data.json`);
    });

    it('should handle {"true"} keyword string shorthand', async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"true":"val"}',
      });
      await compareOutputs(env, testDir, `jq -c '{"true"}' data.json`);
    });

    it("should handle mixed shorthand and explicit keys", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '{"name":"foo","value":42}',
      });
      await compareOutputs(
        env,
        testDir,
        `jq -c '{"name", "v": .value}' data.json`,
      );
    });
  });

  describe("string functions", () => {
    it("should split strings", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '"a,b,c"',
      });
      await compareOutputs(env, testDir, "jq 'split(\",\")' data.json");
    });

    it("should join arrays", async () => {
      const env = await setupFiles(testDir, {
        "data.json": '["a","b","c"]',
      });
      await compareOutputs(env, testDir, "jq 'join(\"-\")' data.json");
    });
  });
});
