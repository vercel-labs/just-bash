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
    // guarded-fetch must be processed by vite-node rather than externalized so
    // `vi.mock("node:dns/promises")` reaches its resolver, which is how
    // dns-guarded-path.test.ts drives resolution without touching real DNS.
    // Keep in sync with vitest.config.ts; that file asserts the mock is in
    // force, so a config that omits this fails loudly rather than silently
    // exercising real DNS.
    server: { deps: { inline: ["guarded-fetch"] } },
    // Tests that patch globalThis (defense-in-depth) or spawn workers need
    // process-level isolation so they don't leak state into thread neighbours.
    poolMatchGlobs: [
      ["forks", "**/security/attacks/**"],
      ["forks", "**/security/defense-in-depth*.test.ts"],
      ["forks", "**/security/sandbox/**"],
      ["forks", "**/sqlite3.worker-protocol-abuse.test.ts"],
      ["forks", "**/python3.worker-protocol-abuse.test.ts"],
      ["forks", "**/python3.queue-desync.runtime.test.ts"],
      ["forks", "**/wasm-callback.test.ts"],
    ],
  },
});
