import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("tr review regressions - GNU comparison", () => {
  let testDir: string;
  beforeEach(async () => {
    testDir = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(testDir);
  });
  it.each([
    "printf aaabbb | tr -ds a b",
    "printf bababccbb | tr -ds a b",
    "printf babab | tr -cds b b",
    "printf aabbb | tr -ds a ''",
    "printf aaa | tr -ds a",
    "printf /wE= | base64 -d | tr -d '\\000-\\037' | base64",
    "printf /wGA | base64 -d | tr '\\001' A | base64",
    "printf /wH/ | base64 -d | tr -ds '\\001' '\\377' | base64",
    "printf /wEBgA== | base64 -d | tr -s '\\001' | base64",
  ])("matches GNU tr: %s", async (command) => {
    const env = await setupFiles(testDir, {});
    await compareOutputs(env, testDir, command, { normalizeWhitespace: true });
  });
});
