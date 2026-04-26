import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: [
      "src/commands/python3/**/*.test.ts",
      "src/commands/sqlite3/**/*.test.ts",
      "src/commands/js-exec/**/*.test.ts",
      "src/agent-examples/python-scripting.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Mock tests (worker-protocol-abuse, queue-timeout-exploit) use
    // vi.mock to replace node:worker_threads. They share module-level queue
    // state with real tests, so each file needs its own module instance.
    isolate: true,
    setupFiles: [resolve(__dirname, "src/vitest-setup.ts")],
    // WASM worker tests need process-level isolation because
    // defense-in-depth patches globalThis which is shared across threads.
    poolMatchGlobs: [
      ["forks", "**/python3*.test.ts"],
      ["forks", "**/sqlite3*.test.ts"],
      ["forks", "**/js-exec*.test.ts"],
      ["forks", "**/python-scripting.test.ts"],
    ],
  },
});
