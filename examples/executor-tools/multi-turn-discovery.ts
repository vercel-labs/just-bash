/**
 * Example 3: Multi-Turn Tool Discovery via executor.setup
 *
 * Demonstrates an AI-agent pattern where tools are auto-discovered from
 * a GraphQL schema by the @executor-js/sdk — no inline tool definitions.
 *
 * The agent:
 *   1. Inspects the executor config to see what sources were registered
 *   2. Calls a discovered tool (countries.country)
 *   3. Queries a list endpoint with filters (countries.countries)
 *   4. Chains multiple discovered tools in a single script
 *   5. Writes results to the virtual filesystem
 *
 * Uses:
 *   - countries.trevorblades.com (GraphQL) — tools auto-discovered via introspection
 *
 * Run with: npx tsx multi-turn-discovery.ts
 */

import { Bash } from "just-bash";

const bash = new Bash({
  executionLimits: { maxJsTimeoutMs: 60000 },
  executor: {
    // No inline tools — everything is discovered from the GraphQL schema.
    // The SDK introspects the schema and registers one tool per query type.
    setup: async (sdk) => {
      await sdk.sources.add({
        kind: "graphql",
        endpoint: "https://countries.trevorblades.com/graphql",
        name: "countries",
        auth: { kind: "none" },
      });
    },
    // Allow all read operations (queries), deny mutations
    onToolApproval: async (req) => {
      if (req.operationKind === "read") return { approved: true };
      return { approved: false, reason: "only read operations allowed" };
    },
  },
});

// ── Turn 1: Agent discovers what sources were registered ─────────
// The executor SDK writes its config to /.executor/ in the virtual
// filesystem. The agent can inspect this to understand what's available.

console.log("=== Turn 1: Discover available sources ===\n");

let r = await bash.exec(`js-exec -c '
  var fs = require("fs");
  var raw = fs.readFileSync("/.executor/config.json", "utf8");
  var config = JSON.parse(raw);
  var sources = config.sources || {};
  var names = Object.keys(sources);
  console.log("Registered sources: " + names.length);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var src = sources[name];
    console.log("  - " + name + " (" + src.kind + ")");
    console.log("    endpoint: " + src.connection.endpoint);
  }
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

// ── Turn 2: Agent calls a discovered query tool ─────────────────
// The SDK registered tools matching the GraphQL queries: country,
// countries, continent, continents, language, languages.
// SDK results have shape: { data, error, headers, status }

console.log("=== Turn 2: Use a discovered tool (single country) ===\n");

r = await bash.exec(`js-exec -c '
  var result = await tools.countries.country({ code: "JP" });
  var c = result.data;
  console.log(c.name);
  console.log("  Capital:   " + c.capital);
  console.log("  Region:    " + c.awsRegion);
  console.log("  Continent: " + c.continent.name);
  var names = [];
  for (var i = 0; i < c.languages.length; i++) { names.push(c.languages[i].name); }
  console.log("  Languages: " + names.join(", "));
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

// ── Turn 3: Agent queries a list endpoint with filter ───────────

console.log("=== Turn 3: List query with filter ===\n");

r = await bash.exec(`js-exec -c '
  var result = await tools.countries.countries({
    filter: { continent: { eq: "SA" } }
  });
  var countries = result.data;
  console.log("South American countries (" + countries.length + "):");
  for (var i = 0; i < countries.length; i++) {
    var c = countries[i];
    console.log("  " + c.name + " — " + c.capital);
  }
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

// ── Turn 4: Agent chains multiple discovered tools ──────────────

console.log("=== Turn 4: Chain multiple tools in one script ===\n");

r = await bash.exec(`js-exec -c '
  var contResult = await tools.countries.continents({});
  var continents = contResult.data;
  console.log("Continents and sample countries:\\n");

  for (var i = 0; i < continents.length; i++) {
    var cont = continents[i];
    var detailResult = await tools.countries.continent({ code: cont.code });
    var detail = detailResult.data;
    var sample = detail.countries.slice(0, 3);
    var names = [];
    for (var j = 0; j < sample.length; j++) { names.push(sample[j].name); }
    var suffix = detail.countries.length > 3 ? ", ..." : "";
    console.log("  " + cont.name + " (" + detail.countries.length + " countries)");
    console.log("    " + names.join(", ") + suffix);
  }
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

// ── Turn 5: Agent writes results to virtual filesystem ──────────

console.log("=== Turn 5: Write results to filesystem ===\n");

r = await bash.exec(`js-exec -c '
  var fs = require("fs");
  var result = await tools.countries.countries({});
  var all = result.data;
  var lines = ["name,capital,continent"];
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    lines.push(c.name + "," + (c.capital || "") + "," + c.continent.name);
  }
  fs.writeFileSync("/tmp/all-countries.csv", lines.join("\\n"));
  console.log("Wrote " + all.length + " countries to /tmp/all-countries.csv");
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr:", r.stderr);

r = await bash.exec("echo '--- First 8 rows:' && head -8 /tmp/all-countries.csv && echo && echo '--- Row count:' && wc -l < /tmp/all-countries.csv");
console.log(r.stdout);

console.log("Done!");
