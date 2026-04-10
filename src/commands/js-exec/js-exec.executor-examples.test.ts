/**
 * Tests for executor tool discovery via the @executor-js/sdk plugin system.
 *
 * Uses the custom discovery plugin to exercise the full discovery code path:
 * setup(sdk) → sdk.sources.add() → tool registration → tool invocation via bridge.
 *
 * defense-in-depth is disabled because Effect's runtime sets Error.stackTraceLimit,
 * which conflicts with the frozen Error constructor in defense-in-depth mode.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// ── Custom discovery plugin tests ───────────────────────────────

function createBashWithCustomSource() {
  return new Bash({
    executionLimits: { maxJsTimeoutMs: 60000 },
    defenseInDepth: false,
    executor: {
      setup: async (sdk) => {
        await sdk.sources.add({
          kind: "custom",
          name: "countries",
          tools: {
            country: {
              description: "Get a country by code",
              execute: (args: { code: string }) => {
                const db: Record<string, unknown> = Object.create(null);
                db["JP"] = {
                  name: "Japan",
                  capital: "Tokyo",
                  continent: "Asia",
                };
                db["US"] = {
                  name: "United States",
                  capital: "Washington D.C.",
                  continent: "North America",
                };
                db["BR"] = {
                  name: "Brazil",
                  capital: "Brasília",
                  continent: "South America",
                };
                db["AR"] = {
                  name: "Argentina",
                  capital: "Buenos Aires",
                  continent: "South America",
                };
                return db[args.code] ?? null;
              },
            },
            list: {
              description: "List all countries",
              execute: (args?: { continent?: string }) => {
                const all = [
                  {
                    code: "JP",
                    name: "Japan",
                    continent: "Asia",
                  },
                  {
                    code: "US",
                    name: "United States",
                    continent: "North America",
                  },
                  {
                    code: "BR",
                    name: "Brazil",
                    continent: "South America",
                  },
                  {
                    code: "AR",
                    name: "Argentina",
                    continent: "South America",
                  },
                ];
                if (args?.continent) {
                  return all.filter((c) => c.continent === args.continent);
                }
                return all;
              },
            },
          },
        });
      },
      onToolApproval: "allow-all",
    },
  });
}

describe("executor.setup: custom source discovery", () => {
  const bash = createBashWithCustomSource();

  it("should call a discovered tool and get a result", async () => {
    const r = await bash.exec(`js-exec -c '
      var result = await tools.countries.country({ code: "JP" });
      console.log(result.name);
      console.log("capital=" + result.capital);
      console.log("continent=" + result.continent);
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("Japan\ncapital=Tokyo\ncontinent=Asia\n");
  });

  it("should list all items from a discovered tool", async () => {
    const r = await bash.exec(`js-exec -c '
      var countries = await tools.countries.list({});
      console.log("count=" + countries.length);
      for (var i = 0; i < countries.length; i++) {
        console.log(countries[i].name);
      }
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("count=4\nJapan\nUnited States\nBrazil\nArgentina\n");
  });

  it("should filter results with arguments", async () => {
    const r = await bash.exec(`js-exec -c '
      var countries = await tools.countries.list({ continent: "South America" });
      console.log("count=" + countries.length);
      for (var i = 0; i < countries.length; i++) {
        console.log(countries[i].name + " — " + countries[i].code);
      }
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("count=2\nBrazil — BR\nArgentina — AR\n");
  });

  it("should chain multiple discovered tools", async () => {
    const r = await bash.exec(`js-exec -c '
      var countries = await tools.countries.list({});
      console.log("total=" + countries.length);
      for (var i = 0; i < countries.length; i++) {
        var detail = await tools.countries.country({ code: countries[i].code });
        console.log(countries[i].code + ": capital=" + detail.capital);
      }
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      [
        "total=4",
        "JP: capital=Tokyo",
        "US: capital=Washington D.C.",
        "BR: capital=Brasília",
        "AR: capital=Buenos Aires",
        "",
      ].join("\n"),
    );
  });

  it("should write discovered data to virtual filesystem", async () => {
    let r = await bash.exec(`js-exec -c '
      var fs = require("fs");
      var countries = await tools.countries.list({});
      var lines = ["name,code"];
      for (var i = 0; i < countries.length; i++) {
        lines.push(countries[i].name + "," + countries[i].code);
      }
      fs.writeFileSync("/tmp/countries.csv", lines.join("\\n"));
      console.log("wrote " + countries.length);
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("wrote 4\n");

    r = await bash.exec("cat /tmp/countries.csv");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(
      "name,code\nJapan,JP\nUnited States,US\nBrazil,BR\nArgentina,AR",
    );
  });
});

// ── Tool approval tests ─────────────────────────────────────────

describe("executor.setup: tool approval", () => {
  it("should allow tools when onToolApproval is allow-all", async () => {
    const bash = new Bash({
      executionLimits: { maxJsTimeoutMs: 60000 },
      defenseInDepth: false,
      executor: {
        setup: async (sdk) => {
          await sdk.sources.add({
            kind: "custom",
            name: "math",
            tools: {
              add: {
                execute: (a: { x: number; y: number }) => ({ sum: a.x + a.y }),
              },
            },
          });
        },
        onToolApproval: "allow-all",
      },
    });
    const r = await bash.exec(`js-exec -c '
      var r = await tools.math.add({ x: 3, y: 4 });
      console.log(r.sum);
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("7\n");
  });

  it("should deny all tools when onToolApproval is deny-all", async () => {
    const bash = new Bash({
      executionLimits: { maxJsTimeoutMs: 60000 },
      defenseInDepth: false,
      executor: {
        setup: async (sdk) => {
          await sdk.sources.add({
            kind: "custom",
            name: "math",
            tools: {
              add: {
                execute: (a: { x: number; y: number }) => ({ sum: a.x + a.y }),
              },
            },
          });
        },
        onToolApproval: "deny-all",
      },
    });
    const r = await bash.exec(`js-exec -c '
      try {
        await tools.math.add({ x: 1, y: 2 });
        console.log("should not reach");
      } catch (e) {
        console.error(e.message);
      }
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Tool invocation denied: math.add");
  });

  it("should call custom approval callback with tool metadata", async () => {
    const approvalLog: string[] = [];
    const bash = new Bash({
      executionLimits: { maxJsTimeoutMs: 60000 },
      defenseInDepth: false,
      executor: {
        setup: async (sdk) => {
          await sdk.sources.add({
            kind: "custom",
            name: "api",
            tools: {
              read: {
                description: "Read data",
                execute: () => ({ data: "ok" }),
              },
              write: {
                description: "Write data",
                execute: () => ({ written: true }),
              },
            },
          });
        },
        onToolApproval: async (req) => {
          approvalLog.push(`${req.toolPath}:${req.sourceId}`);
          // Allow reads, deny writes
          if (req.toolPath.endsWith(".read")) return { approved: true };
          return { approved: false, reason: "writes not allowed" };
        },
      },
    });

    // Read should succeed
    const r1 = await bash.exec(`js-exec -c '
      var r = await tools.api.read({});
      console.log(r.data);
    '`);
    expect(r1.exitCode).toBe(0);
    expect(r1.stdout).toBe("ok\n");

    // Write should be denied
    const r2 = await bash.exec(`js-exec -c '
      try {
        await tools.api.write({});
        console.log("should not reach");
      } catch (e) {
        console.error(e.message);
      }
    '`);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toBe("");
    expect(r2.stderr).toContain("writes not allowed");

    // Verify approval callback received correct metadata
    expect(approvalLog).toEqual(["api.read:api", "api.write:api"]);
  });

  it("should include denial reason in error message", async () => {
    const bash = new Bash({
      executionLimits: { maxJsTimeoutMs: 60000 },
      defenseInDepth: false,
      executor: {
        setup: async (sdk) => {
          await sdk.sources.add({
            kind: "custom",
            name: "ops",
            tools: {
              deploy: { execute: () => ({}) },
            },
          });
        },
        onToolApproval: async () => ({
          approved: false,
          reason: "requires admin role",
        }),
      },
    });
    const r = await bash.exec(`js-exec -c '
      try {
        await tools.ops.deploy({});
      } catch (e) {
        console.error(e.message);
      }
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("Tool invocation denied: ops.deploy");
    expect(r.stderr).toContain("requires admin role");
  });
});

// ── GraphQL/OpenAPI discovery tests (skipped — require unpublished plugins) ──

// TODO: Restore these tests when @executor-js/plugin-graphql is published on npm.
// The tests below exercised full GraphQL schema introspection → tool discovery → invocation
// using a local mock server. They are preserved for easy restoration.
//
// Original test setup:
// - Mock GraphQL server with introspection endpoint
// - sdk.sources.add({ kind: "graphql", endpoint: "http://127.0.0.1:PORT/graphql", name: "countries" })
// - Auto-discovered tools: countries.country, countries.countries, countries.continent, etc.
// - SDK result shape: { data, error, headers, status }

describe.skip("executor.setup: GraphQL tool discovery", () => {
  it("should discover source config in /.executor/config.json", () => {
    // TODO: Requires @executor-js/plugin-graphql
  });

  it("should call a discovered country tool", () => {
    // TODO: Requires @executor-js/plugin-graphql
  });

  it("should query countries list with filter", () => {
    // TODO: Requires @executor-js/plugin-graphql
  });

  it("should chain multiple discovered tools", () => {
    // TODO: Requires @executor-js/plugin-graphql
  });

  it("should write discovered data to virtual filesystem", () => {
    // TODO: Requires @executor-js/plugin-graphql
  });
});
