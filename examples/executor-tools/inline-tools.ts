/**
 * Example 1: Inline Tools
 *
 * Demonstrates defining tools and calling them from sandboxed js-exec scripts.
 * No @executor-js/sdk plugins required for inline tools — only the SDK itself
 * is needed via @just-bash/executor's peer deps.
 *
 * Uses:
 *   - countries.trevorblades.com (GraphQL) — country data
 *
 * Run with: npx tsx inline-tools.ts
 */

import { createExecutor } from "@just-bash/executor";
import { Bash } from "just-bash";

const executor = await createExecutor({
  tools: {
    // GraphQL tool — queries countries.trevorblades.com
    "countries.list": {
      description: "List countries, optionally filtered by continent code",
      execute: async (args?: { continent?: string }) => {
        const query = args?.continent
          ? `query($code: String!) { countries(filter: { continent: { eq: $code } }) { code name capital emoji } }`
          : `{ countries { code name capital emoji } }`;
        const variables = args?.continent
          ? { code: args.continent }
          : undefined;
        const res = await fetch("https://countries.trevorblades.com/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables }),
        });
        const json = (await res.json()) as { data: { countries: unknown[] } };
        return json.data.countries;
      },
    },

    "countries.get": {
      description: "Get a single country by ISO code",
      execute: async (args: { code: string }) => {
        const query = `query($code: ID!) { country(code: $code) { name capital currency emoji languages { name } continent { name } } }`;
        const res = await fetch("https://countries.trevorblades.com/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables: { code: args.code } }),
        });
        const json = (await res.json()) as { data: { country: unknown } };
        return json.data.country;
      },
    },

    // Simple sync tools
    "util.timestamp": {
      description: "Current Unix timestamp",
      execute: () => ({ ts: Math.floor(Date.now() / 1000) }),
    },
    "util.random": {
      description: "Random number between min and max",
      execute: (args: { min?: number; max?: number }) => ({
        value: Math.floor(
          Math.random() * ((args.max ?? 100) - (args.min ?? 0)) +
            (args.min ?? 0),
        ),
      }),
    },
  },
});

const bash = new Bash({
  executionLimits: { maxJsTimeoutMs: 60000 },
  customCommands: executor.commands,
  javascript: { invokeTool: executor.invokeTool },
});

// 1. List European countries
console.log("1. European countries:");
let r = await bash.exec(`js-exec -c '
  const countries = await tools.countries.list({ continent: "EU" });
  console.log(countries.length + " countries in Europe");
  for (const c of countries.slice(0, 5)) {
    console.log("  " + c.emoji + " " + c.name + " — " + c.capital);
  }
  console.log("  ...");
'`);
console.log(r.stdout);

// 2. Country detail
console.log("2. Country detail:");
r = await bash.exec(`js-exec -c '
  const c = await tools.countries.get({ code: "JP" });
  console.log(c.emoji + " " + c.name);
  console.log("  Capital:    " + c.capital);
  console.log("  Currency:   " + c.currency);
  console.log("  Continent:  " + c.continent.name);
  console.log("  Languages:  " + c.languages.map(l => l.name).join(", "));
'`);
console.log(r.stdout);

// 3. Mix tools from different sources
console.log("3. Cross-tool script:");
r = await bash.exec(`js-exec -c '
  const ts = await tools.util.timestamp();
  const rand = await tools.util.random({ min: 0, max: 249 });
  const all = await tools.countries.list();
  const pick = all[rand.value];

  console.log("Report at " + ts.ts);
  console.log("Random country #" + rand.value + ": " + pick.emoji + " " + pick.name);
'`);
console.log(r.stdout);

// 4. Tools + virtual filesystem
console.log("4. Fetch → write to fs → read with bash:");
r = await bash.exec(`js-exec -c '
  const fs = require("fs");
  const countries = await tools.countries.list({ continent: "SA" });
  const csv = "code,name,capital\\n" +
    countries.map(c => c.code + "," + c.name + "," + c.capital).join("\\n");
  fs.writeFileSync("/tmp/south-america.csv", csv);
  console.log("Wrote " + countries.length + " rows to /tmp/south-america.csv");
'`);
console.log(r.stdout);

r = await bash.exec("cat /tmp/south-america.csv | head -5");
console.log("  " + r.stdout.split("\n").join("\n  "));

// 5. Error handling
console.log("5. Error handling:");
r = await bash.exec(`js-exec -c '
  try {
    await tools.countries.get({ code: "NOPE" });
  } catch (e) {
    console.error("Caught: " + e.message);
  }
  console.log("Script continued after error");
'`);
console.log(r.stdout);
if (r.stderr) console.log("  stderr: " + r.stderr);

console.log("Done!");
