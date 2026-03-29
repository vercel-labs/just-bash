import { beforeAll, afterAll } from "vitest";
import { setupWorkflowTests, teardownWorkflowTests } from "@workflow/vitest";

beforeAll(async () => {
  await setupWorkflowTests();
});

afterAll(async () => {
  await teardownWorkflowTests();
});
