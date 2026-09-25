import { resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("WorkerLifecycle browser build", () => {
  it("bundles the shared lifecycle as a browser entry", async () => {
    // Check this module directly, regardless of what the main browser entry imports.
    const shim = resolve(__dirname, "shims/browser-unsupported.js");
    const result = await build({
      absWorkingDir: resolve(__dirname, ".."),
      entryPoints: ["src/worker-lifecycle.ts"],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      define: { __BROWSER__: "true" },
      alias: {
        "node:async_hooks": shim,
        "node:dns": shim,
        "node:module": shim,
      },
    });

    expect(result.outputFiles).toHaveLength(1);
  });
});
