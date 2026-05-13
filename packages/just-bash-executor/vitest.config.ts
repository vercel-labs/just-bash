import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// @executor-js/sdk targets Node >= 22 (its Effect runtime relies on features
// missing in Node 20). Skip the entire suite on older runtimes rather than
// trying to make each test individually opt out.
const nodeMajor = Number(process.versions.node.split(".")[0]);
const skipAllTests = nodeMajor < 22;

export default defineConfig({
  resolve: {
    alias: {
      "just-bash": fileURLToPath(
        new URL("../just-bash/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ...(skipAllTests ? ["**/*.test.ts"] : []),
    ],
    passWithNoTests: skipAllTests,
    pool: "threads",
    isolate: false,
    poolMatchGlobs: [
      // SDK tests spawn js-exec workers via just-bash, which patch globals.
      ["forks", "**/executor-examples.test.ts"],
    ],
  },
});
