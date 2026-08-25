/**
 * Browser-build behavior of the secure fetch adapter.
 *
 * guarded-fetch is undici-backed and Node-only, so the browser build folds it
 * out entirely. That leaves two things worth pinning down, neither of which is
 * observable from a normal Node test because the branch is chosen by a
 * compile-time define: importing the module must not emit an unhandled
 * rejection, and requests must still work through the ambient `fetch` the way
 * they did before guarded-fetch was adopted — while private-range enforcement
 * still fails closed, since the browser cannot pin a connection.
 *
 * The module is bundled here the same way `build:browser` bundles it.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SecureFetch } from "./fetch.js";
import type { NetworkConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(__dirname, "..", "..");

let tempDir: string;
let createSecureFetch: (config: NetworkConfig) => SecureFetch;
let unhandled: unknown[];

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "just-bash-browser-fetch-"));
  const outfile = join(tempDir, "fetch.browser.js");

  // Same shape as the build:browser script: browser platform, __BROWSER__
  // defined, Node-only modules aliased to the unsupported shim.
  await execFileAsync(
    resolve(packageRoot, "node_modules/.bin/esbuild"),
    [
      resolve(packageRoot, "src/network/fetch.ts"),
      "--bundle",
      "--platform=browser",
      "--format=esm",
      `--outfile=${outfile}`,
      "--define:__BROWSER__=true",
      "--alias:node:async_hooks=./src/shims/browser-unsupported.js",
      "--alias:node:dns=./src/shims/browser-unsupported.js",
      "--alias:node:module=./src/shims/browser-unsupported.js",
      "--external:guarded-fetch",
    ],
    { cwd: packageRoot },
  );

  unhandled = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  ({ createSecureFetch } = await import(outfile));
  // Let the microtask queue drain so a module-init rejection would surface.
  await new Promise((r) => setTimeout(r, 0));
  process.off("unhandledRejection", onUnhandled);
}, 30000);

afterAll(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("browser build", () => {
  it("does not import guarded-fetch", async () => {
    const { readFile } = await import("node:fs/promises");
    const bundle = await readFile(join(tempDir, "fetch.browser.js"), "utf-8");
    // The module name still appears in error text; what must be gone is any
    // static or dynamic import of it, which a browser could not resolve.
    expect(bundle).not.toMatch(/from\s*["']guarded-fetch["']/);
    expect(bundle).not.toMatch(/import\s*\(\s*["']guarded-fetch["']\s*\)/);
    expect(bundle).not.toMatch(/require\s*\(\s*["']guarded-fetch["']\s*\)/);
  });

  it("emits no unhandled rejection on import", () => {
    expect(unhandled).toEqual([]);
  });

  it("serves an allow-listed request through the ambient fetch", async () => {
    // Patch the global rather than injecting `_fetch`: the point is that the
    // browser build still uses the page's own fetch, as it did before.
    const original = globalThis.fetch;
    const transport = vi.fn(async () => new Response("browser-body"));
    globalThis.fetch = transport as unknown as typeof fetch;
    try {
      const secureFetch = createSecureFetch({
        allowedUrlPrefixes: ["https://api.example.com"],
        denyPrivateRanges: false,
      });

      const result = await secureFetch("https://api.example.com/data");

      expect(new TextDecoder().decode(result.body)).toBe("browser-body");
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("still enforces the allow-list", async () => {
    const transport = vi.fn(async () => new Response("browser-body"));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: false,
      _fetch: transport,
    });

    await expect(secureFetch("https://evil.com/data")).rejects.toThrow(
      "URL not in allow-list",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed when private-range enforcement is requested", async () => {
    // No undici in the browser means no connect-time pinning, so a policy that
    // depends on it must refuse rather than run unprotected.
    const transport = vi.fn(async () => new Response("browser-body"));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: true,
      _fetch: transport,
    });

    await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
      "DNS pinning unavailable for private IP enforcement",
    );
    expect(transport).not.toHaveBeenCalled();
  });
});
