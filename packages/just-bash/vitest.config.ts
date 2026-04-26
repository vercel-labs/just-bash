import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    setupFiles: [resolve(__dirname, "src/vitest-setup.ts")],
    // Tests that spawn workers (sqlite3, python) need process-level isolation
    // because defense-in-depth patches globalThis which is shared across threads.
    // Tests that need process-level isolation because defense-in-depth
    // patches globalThis (shared across threads with isolate: false).
    // Note: mock-based tests (queue-timeout-exploit) prefer threads,
    // but vi.mock works in forks as of vitest v4.
    poolMatchGlobs: [
      ["forks", "**/security/attacks/**"],
      ["forks", "**/security/defense-in-depth-box*.test.ts"],
      ["forks", "**/browser.bundle.test.ts"],
      ["forks", "**/python3.test.ts"],
      ["forks", "**/python3.advanced.test.ts"],
      ["forks", "**/python3.env.test.ts"],
      ["forks", "**/python3.files.test.ts"],
      ["forks", "**/python3.http.test.ts"],
      ["forks", "**/python3.oop.test.ts"],
      ["forks", "**/python3.optin.test.ts"],
      ["forks", "**/python3.security.test.ts"],
      ["forks", "**/python3.stdlib.test.ts"],
      ["forks", "**/python-scripting.test.ts"],
      ["forks", "**/sqlite3.worker-protocol-abuse.test.ts"],
      ["forks", "**/js-exec*.test.ts"],
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
