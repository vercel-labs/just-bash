/**
 * Example 2: Multi-Turn Tool Discovery via createExecutor.setup
 *
 * Demonstrates an AI-agent pattern where tools are registered through the
 * `@executor-js/sdk` discovery pipeline rather than inline. The SDK applies
 * approval/elicitation gates to every call.
 *
 * The agent:
 *   1. Inspects the SDK handle to see what sources were registered
 *   2. Calls a discovered tool (single country)
 *   3. Filters a list endpoint
 *   4. Chains multiple discovered tools in a single script
 *   5. Writes results to the virtual filesystem
 *
 * Run with: npx tsx multi-turn-discovery.ts
 */

import { createExecutor } from "@just-bash/executor";
import { Bash } from "just-bash";

const COUNTRIES = {
  JP: { name: "Japan", capital: "Tokyo", continent: "Asia" },
  US: { name: "United States", capital: "Washington D.C.", continent: "North America" },
  BR: { name: "Brazil", capital: "Brasília", continent: "South America" },
  AR: { name: "Argentina", capital: "Buenos Aires", continent: "South America" },
  DE: { name: "Germany", capital: "Berlin", continent: "Europe" },
  FR: { name: "France", capital: "Paris", continent: "Europe" },
  KE: { name: "Kenya", capital: "Nairobi", continent: "Africa" },
} as const;

// Tools are registered via the SDK's discovery pipeline (kind: "custom"),
// so calls flow through approval/elicitation gates. For real GraphQL/OpenAPI/
// MCP sources, swap the source kind — same architecture, different upstream.
const executor = await createExecutor({
  setup: async (sdk) => {
    await sdk.sources.add({
      kind: "custom",
      name: "countries",
      tools: {
        country: {
          description: "Get a country by ISO code",
          execute: (args: { code: keyof typeof COUNTRIES }) =>
            COUNTRIES[args.code] ?? null,
        },
        list: {
          description: "List all countries (optionally filtered by continent)",
          execute: (args?: { continent?: string }) => {
            const all = Object.entries(COUNTRIES).map(([code, c]) => ({
              code,
              ...c,
            }));
            if (args?.continent) {
              return all.filter((c) => c.continent === args.continent);
            }
            return all;
          },
        },
      },
    });
  },
  // Approve every tool call. Real apps would check req.toolPath / req.args
  // against a policy and prompt the user for sensitive operations.
  onToolApproval: "allow-all",
});

const bash = new Bash({
  executionLimits: { maxJsTimeoutMs: 60000 },
  customCommands: executor.commands,
  javascript: { invokeTool: executor.invokeTool },
});

// ── Turn 1: List discovered tools via the host-side SDK handle ───
// `executor.sdk` is the SDK instance, exposed for inspection.

console.log("=== Turn 1: Discover available sources ===\n");

if (executor.sdk) {
  const sources = await executor.sdk.sources.list();
  console.log(`Registered sources: ${sources.length}`);
  for (const src of sources as { id: string; kind: string }[]) {
    console.log(`  - ${src.id} (${src.kind})`);
  }
  const allTools = await executor.sdk.tools.list();
  console.log(`\nDiscovered tools: ${allTools.length}`);
  for (const t of (allTools as { id: string }[]).slice(0, 6)) {
    console.log(`  - ${t.id}`);
  }
}
console.log();

// ── Turn 2: Agent calls a discovered query tool ─────────────────
// The SDK registered tools matching the GraphQL queries: country,
// countries, continent, continents, language, languages.
// invokeTool unwraps the SDK's `.data` envelope, so scripts get the
// query result directly.

console.log("=== Turn 2: Use a discovered tool (single country) ===\n");

let r = await bash.exec(`js-exec -c '
  var c = await tools.countries.country({ code: "JP" });
  console.log(c.name);
  console.log("  Capital:   " + c.capital);
  console.log("  Continent: " + c.continent);
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

// ── Turn 3: Agent filters a list endpoint ───────────────────────

console.log("=== Turn 3: List with filter ===\n");

r = await bash.exec(`js-exec -c '
  var countries = await tools.countries.list({ continent: "South America" });
  console.log("South American countries (" + countries.length + "):");
  for (var i = 0; i < countries.length; i++) {
    var c = countries[i];
    console.log("  " + c.name + " — " + c.capital);
  }
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

// ── Turn 4: Agent chains tools — group by continent ─────────────

console.log("=== Turn 4: Chain multiple tools in one script ===\n");

r = await bash.exec(`js-exec -c '
  var all = await tools.countries.list({});
  var byContinent = {};
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    (byContinent[c.continent] = byContinent[c.continent] || []).push(c.name);
  }
  console.log("Countries by continent:\\n");
  var keys = Object.keys(byContinent).sort();
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    console.log("  " + key + " (" + byContinent[key].length + ")");
    console.log("    " + byContinent[key].join(", "));
  }
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

// ── Turn 5: Agent writes results to virtual filesystem ──────────

console.log("=== Turn 5: Write results to filesystem ===\n");

r = await bash.exec(`js-exec -c '
  var fs = require("fs");
  var all = await tools.countries.list({});
  var lines = ["code,name,capital,continent"];
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    lines.push(c.code + "," + c.name + "," + c.capital + "," + c.continent);
  }
  fs.writeFileSync("/tmp/all-countries.csv", lines.join("\\n"));
  console.log("Wrote " + all.length + " countries to /tmp/all-countries.csv");
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

r = await bash.exec("echo '--- First 8 rows:' && head -8 /tmp/all-countries.csv && echo && echo '--- Row count:' && wc -l < /tmp/all-countries.csv");
console.log(r.stdout);

console.log("Done!");
