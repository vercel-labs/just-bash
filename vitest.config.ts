import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/examples/**",
      "**/.pnpm-store/**",
    ],
    pool: "threads",
    isolate: false,
    setupFiles: ["./src/test-setup.ts"],
    // Tests that spawn workers (sqlite3, python) need process-level isolation
    // because defense-in-depth patches globalThis which is shared across threads.
    poolMatchGlobs: [
      ["forks", "**/security/attacks/**"],
      ["forks", "**/security/defense-in-depth-box*.test.ts"],
      ["forks", "**/browser.bundle.test.ts"],
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.comparison.test.ts",
        "src/spec-tests/**",
        "src/comparison-tests/**",
        "src/cli/**",
        "src/agent-examples/**",
      ],
    },
  },
});
