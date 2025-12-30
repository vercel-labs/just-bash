import { afterAll } from "vitest";
import { isRecordMode, writeAllFixtures } from "./test-helpers.js";

// Write all accumulated fixtures after all tests complete
afterAll(async () => {
  if (isRecordMode) {
    await writeAllFixtures();
  }
});
