import { buildWorkflowTests } from "@workflow/vitest";

export async function setup() {
  await buildWorkflowTests();
}
