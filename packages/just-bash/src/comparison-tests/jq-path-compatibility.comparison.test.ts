import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq existing path filters", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  it.each([
    "path(if true then . else empty end)",
    "path(try .)",
    "path(. as $x | .)",
    "path(def keep: .; keep)",
    "path(objects)",
    "try path(.a.b | select(. == null)) catch .",
    "try pick(.a.b | select(. == null)) catch .",
    "path(values)",
    "path(.a | numbers)",
    "pick(if true then . else empty end)",
  ])("preserves %s", async (filter) => {
    const env = await setupFiles(testDir, { "input.json": '{"a":1}' });
    await compareOutputs(env, testDir, `jq -c '${filter}' input.json`);
  });

  it("preserves own named arguments with prototype-related names", async () => {
    const env = await setupFiles(testDir, { "input.json": "null" });
    await compareOutputs(
      env,
      testDir,
      `jq -c --arg __proto__ keep '$ARGS.named | path(.["__proto__"] | select(. == "keep"))' input.json`,
    );
  });
});
