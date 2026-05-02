import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**"],
    pool: "threads",
    isolate: false,
    poolMatchGlobs: [
      // SDK tests spawn js-exec workers via just-bash, which patch globals.
      ["forks", "**/executor-examples.test.ts"],
    ],
  },
});
