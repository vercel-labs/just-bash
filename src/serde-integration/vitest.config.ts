import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workflowTransformPlugin } from "@workflow/rollup";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    workflowTransformPlugin({
      exclude: [`${resolve(__dirname, ".workflow-vitest")}/`],
    }),
  ],
  test: {
    include: ["**/*.integration.test.ts"],
    testTimeout: 60_000,
    globalSetup: [resolve(__dirname, "vitest.global-setup.ts")],
    setupFiles: [resolve(__dirname, "vitest.setup.ts")],
  },
});
