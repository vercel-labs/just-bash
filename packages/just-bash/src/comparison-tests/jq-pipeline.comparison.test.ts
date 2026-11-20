import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("jq pipeline input/output parity", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });
  it.each([
    "jq -r .id a.json b.json | cat",
    "jq -cs . a.json b.json | cat",
    "jq -R . a.json b.json | cat",
    "cat a.json b.json | jq -c . | cat",
  ])("matches jq: %s", async (command) => {
    await compareOutputs(
      await setupFiles(directory, {
        "a.json": '{"id":"café"}\n{"id":2}\n',
        "b.json": '{"id":3}\n',
      }),
      directory,
      command,
    );
  });
});
