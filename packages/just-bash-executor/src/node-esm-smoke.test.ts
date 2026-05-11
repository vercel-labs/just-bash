/**
 * Node ESM consumer smoke tests.
 *
 * Vitest's module resolver is more forgiving than Node ESM — it deferred
 * resolution of broken upstream imports (notably `@executor-js/api` in
 * plugin@0.1.0) so unit tests passed while real consumers crashed at load.
 *
 * These tests spawn a real `node` subprocess to exercise the consumer
 * resolution path. If a future upstream `@executor-js/plugin-*` release ships
 * another packaging regression, these fail fast where the unit tests wouldn't.
 *
 * Each test runs a tiny inline script — no temp files, no network.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spawn `node` from the example consumer's directory — that's where the
 * @executor-js/* packages are installed alongside @just-bash/executor and
 * just-bash, so Node's package resolution sees the same view a real consumer
 * would.
 */
const CWD = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "examples",
  "executor-tools",
);

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function nodeRun(script: string, timeoutMs = 20_000): RunResult {
  const r = spawnSync("node", ["--input-type=module", "-e", script], {
    cwd: CWD,
    encoding: "utf-8",
    timeout: timeoutMs,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function failureContext(r: RunResult): string {
  return `exit=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
}

// ── 1. Each upstream plugin loads + instantiates in plain Node ESM ─────────

const PLUGIN_FACTORIES: Array<[string, string]> = [
  ["@executor-js/plugin-graphql/core", "graphqlPlugin"],
  ["@executor-js/plugin-openapi/core", "openApiPlugin"],
  ["@executor-js/plugin-mcp/core", "mcpPlugin"],
];

describe("@executor-js plugins load in plain Node ESM", () => {
  for (const [pkg, factoryName] of PLUGIN_FACTORIES) {
    it(`${pkg} → ${factoryName}() succeeds`, () => {
      const r = nodeRun(`
        const mod = await import(${JSON.stringify(pkg)});
        if (typeof mod[${JSON.stringify(factoryName)}] !== "function") {
          throw new Error("missing export ${factoryName}");
        }
        const plugin = mod[${JSON.stringify(factoryName)}]();
        if (!plugin || typeof plugin !== "object") {
          throw new Error("factory returned non-object");
        }
        console.log("OK");
      `);
      expect(r.status, failureContext(r)).toBe(0);
      expect(r.stdout.trim()).toBe("OK");
    });
  }
});

// ── 2. @just-bash/executor's plugin-loader path works for each kind ─────────
//
// This exercises `loadOfficialPlugins` (the function that hit the @0.1.0
// `@executor-js/api` packaging bug). Uses `setup` so the official plugin
// gets loaded via dynamic import inside our wrapper.

describe("@just-bash/executor SDK setup loads plugins via Node ESM", () => {
  it("setup with kind: 'graphql' (introspectionJson) registers tools", () => {
    // Use the same fixture the in-process test relies on — pass its absolute
    // path into the spawned script so we don't have to inline ~2k lines of
    // JSON into an `-e` string.
    const fixturePath = path.join(
      import.meta.dirname,
      "fixtures",
      "countries-introspection.json",
    );

    const r = nodeRun(
      `
      const fs = await import("node:fs");
      const { createExecutor } = await import("@just-bash/executor");

      const introspection = fs.readFileSync(${JSON.stringify(fixturePath)}, "utf-8");

      const executor = await createExecutor({
        setup: async (sdk) => {
          await sdk.sources.add({
            kind: "graphql",
            endpoint: "https://example.invalid/graphql",
            introspectionJson: introspection,
            name: "demo",
          });
        },
        onToolApproval: "allow-all",
        onElicitation: "accept-all",
      });

      const tools = await executor.sdk.tools.list();
      const ids = tools.map((t) => t.id).filter((id) => id.startsWith("demo."));
      if (ids.length === 0) throw new Error("no demo.* tools registered");
      console.log("OK count=" + ids.length);
    `,
      30_000,
    );
    expect(r.status, failureContext(r)).toBe(0);
    expect(r.stdout).toContain("OK count=");
  });

  it("setup with kind: 'openapi' (inline spec) registers tools", () => {
    const r = nodeRun(
      `
      const { createExecutor } = await import("@just-bash/executor");

      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "T", version: "1" },
        paths: {
          "/x": { get: { operationId: "getX", responses: { 200: { description: "ok" } } } },
        },
      });

      const executor = await createExecutor({
        setup: async (sdk) => {
          await sdk.sources.add({
            kind: "openapi",
            spec,
            endpoint: "https://example.invalid",
            name: "demo",
          });
        },
        onToolApproval: "allow-all",
        onElicitation: "accept-all",
      });

      const tools = await executor.sdk.tools.list();
      const ids = tools.map((t) => t.id).filter((id) => id.startsWith("demo."));
      if (ids.length === 0) throw new Error("no demo.* tools registered");
      console.log("OK count=" + ids.length);
    `,
      30_000,
    );
    expect(r.status, failureContext(r)).toBe(0);
    expect(r.stdout).toContain("OK count=");
  });
});

// ── 3. Inline tools path doesn't need any plugin at all ─────────────────────

describe("@just-bash/executor inline tools work in plain Node ESM", () => {
  it("createExecutor with inline tools, no plugins, no SDK setup", () => {
    const r = nodeRun(`
      const { createExecutor } = await import("@just-bash/executor");
      const { Bash } = await import("just-bash");

      const executor = await createExecutor({
        tools: {
          "math.add": {
            description: "add",
            execute: ({ a, b }) => ({ sum: a + b }),
          },
        },
      });

      const bash = new Bash({
        customCommands: executor.commands,
        javascript: { invokeTool: executor.invokeTool },
      });

      const r = await bash.exec("math add a=2 b=3");
      if (r.stdout.trim() !== '{"sum":5}') {
        throw new Error("unexpected stdout: " + r.stdout);
      }
      console.log("OK");
    `);
    expect(r.status, failureContext(r)).toBe(0);
    expect(r.stdout.trim()).toBe("OK");
  });
});
