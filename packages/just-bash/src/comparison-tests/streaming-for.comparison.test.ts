import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("for pipeline producer parity", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await createTestDir();
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });
  it.each([
    'f=outside; for f in a b c; do echo "$f"; done | cat; echo "$f"',
    'for f in a b c; do echo "$f"; continue; echo bad; done | cat',
    'for f in a b c; do echo "$f"; break; done | cat',
    'for f in a b; do { echo "$f"; } > out; cat out; done | cat',
  ])("matches bash: %s", async (command) => {
    await compareOutputs(await setupFiles(directory, {}), directory, command);
  });
});
