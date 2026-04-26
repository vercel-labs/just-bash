import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/comparison-tests/**",
      "**/python3/**",
      "**/sqlite3/**",
      "**/js-exec/**",
      "**/python-scripting*",
    ],
    setupFiles: [resolve(__dirname, "src/vitest-setup.ts")],
    // Tests that patch globalThis (defense-in-depth) or spawn workers need
    // process-level isolation so they don't leak state into thread neighbours.
    poolMatchGlobs: [
      ["forks", "**/security/attacks/**"],
      ["forks", "**/security/defense-in-depth-box*.test.ts"],
      ["forks", "**/security/defense-in-depth-hardening.test.ts"],
      ["forks", "**/security/sandbox/**"],
      ["forks", "**/sqlite3.worker-protocol-abuse.test.ts"],
      ["forks", "**/python3.worker-protocol-abuse.test.ts"],
      ["forks", "**/python3.queue-desync.runtime.test.ts"],
      ["forks", "**/wasm-callback.test.ts"],
    ],
  },
});
