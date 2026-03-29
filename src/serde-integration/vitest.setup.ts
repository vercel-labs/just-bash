import { setupWorkflowTests, teardownWorkflowTests } from "@workflow/vitest";
import { afterAll, beforeAll } from "vitest";

beforeAll(async () => {
  await setupWorkflowTests();
});

afterAll(async () => {
  await teardownWorkflowTests();
});
