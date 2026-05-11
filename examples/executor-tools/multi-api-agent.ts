/**
 * Example 3: Multi-API agent loop
 *
 * Three real public APIs, exposed as inline executor tools and orchestrated
 * across multiple js-exec turns to produce a combined "country snapshot."
 *
 * Sources:
 *   - REST Countries  (https://restcountries.com)        — geo + currency
 *   - Open-Meteo      (https://open-meteo.com)            — current weather
 *   - Wikipedia REST  (https://en.wikipedia.org)          — summary blurb
 *
 * No auth required for any of them. Tools that need auth would live next to
 * these as inline tools that read tokens from env vars and add the header
 * before fetching — the same pattern as the upstream `headers:` config on
 * SDK-discovered sources, just expressed in JS.
 *
 * Run with: npx tsx multi-api-agent.ts [COUNTRY_CODE]   (default: JP)
 */

import { createExecutor } from "@just-bash/executor";
import { Bash } from "just-bash";

const ARG = process.argv[2] ?? "JP";

interface CountryRecord {
  cca2: string;
  name: { common: string };
  capital?: string[];
  capitalInfo?: { latlng?: [number, number] };
  currencies?: Record<string, { name: string; symbol?: string }>;
  population: number;
}

interface WeatherCurrent {
  temperature_2m: number;
  wind_speed_10m: number;
  weather_code: number;
  time: string;
}

interface WikiSummary {
  title: string;
  extract: string;
  content_urls?: { desktop?: { page?: string } };
}

// ── Inline tools ─────────────────────────────────────────────────────────

const callLog: string[] = [];

const executor = await createExecutor({
  tools: {
    "country.lookup": {
      description: "Get a country by ISO 3166-1 alpha-2 code (e.g. JP, US, DE)",
      execute: async (args: { code: string }) => {
        callLog.push(`country.lookup(${args.code})`);
        const url = `https://restcountries.com/v3.1/alpha/${encodeURIComponent(
          args.code,
        )}?fields=cca2,name,capital,capitalInfo,currencies,population`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`restcountries: ${res.status}`);
        const body = (await res.json()) as CountryRecord | CountryRecord[];
        // The API returns an array for query lookups but a single object for
        // alpha-code lookups. Normalize.
        const record = Array.isArray(body) ? body[0] : body;
        if (!record) throw new Error(`no country for code ${args.code}`);
        const currencyEntry = Object.entries(record.currencies ?? {})[0];
        return {
          code: record.cca2,
          name: record.name.common,
          capital: record.capital?.[0] ?? null,
          latlng: record.capitalInfo?.latlng ?? null,
          population: record.population,
          currency: currencyEntry
            ? { code: currencyEntry[0], name: currencyEntry[1].name }
            : null,
        };
      },
    },

    "weather.current": {
      description: "Current weather for a lat/long (Open-Meteo)",
      execute: async (args: { lat: number; lon: number }) => {
        callLog.push(`weather.current(${args.lat},${args.lon})`);
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${args.lat}` +
          `&longitude=${args.lon}` +
          `&current=temperature_2m,wind_speed_10m,weather_code`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`open-meteo: ${res.status}`);
        const json = (await res.json()) as { current: WeatherCurrent };
        return {
          temperatureC: json.current.temperature_2m,
          windKph: json.current.wind_speed_10m,
          weatherCode: json.current.weather_code,
          observedAt: json.current.time,
        };
      },
    },

    "wiki.summary": {
      description: "Wikipedia REST summary for a page title",
      execute: async (args: { title: string }) => {
        callLog.push(`wiki.summary(${args.title})`);
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          args.title,
        )}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "just-bash-executor-example/1.0" },
        });
        if (!res.ok) throw new Error(`wikipedia: ${res.status}`);
        const json = (await res.json()) as WikiSummary;
        return {
          title: json.title,
          summary: json.extract,
          url: json.content_urls?.desktop?.page ?? null,
        };
      },
    },

    "util.now": {
      description: "Current ISO timestamp",
      execute: () => {
        callLog.push("util.now()");
        return { ts: new Date().toISOString() };
      },
    },
  },
});

const bash = new Bash({
  customCommands: executor.commands,
  javascript: { invokeTool: executor.invokeTool },
  executionLimits: { maxJsTimeoutMs: 60_000 },
});

console.log(`\n=== Country snapshot: ${ARG} ===\n`);

// ── Turn 1: agent gathers all three pieces in parallel ──────────────────

console.log("--- Turn 1: parallel lookup (country → weather + wiki) ---");
let r = await bash.exec(`js-exec -c '
  var country = await tools.country.lookup({ code: ${JSON.stringify(ARG)} });
  console.log("Country:    " + country.name + " (" + country.code + ")");
  console.log("Capital:    " + (country.capital || "—"));
  console.log("Population: " + country.population.toLocaleString());
  console.log("Currency:   " + (country.currency ? country.currency.name + " (" + country.currency.code + ")" : "—"));
  console.log("Coords:     " + (country.latlng ? country.latlng.join(", ") : "—"));

  if (!country.latlng) throw new Error("no coords for capital");

  var weather = await tools.weather.current({ lat: country.latlng[0], lon: country.latlng[1] });
  console.log();
  console.log("Weather at capital (" + weather.observedAt + "):");
  console.log("  " + weather.temperatureC + " °C, wind " + weather.windKph + " km/h");

  var wiki = await tools.wiki.summary({ title: country.name });
  console.log();
  console.log("Wikipedia: " + wiki.title);
  console.log("  " + wiki.summary.slice(0, 220) + (wiki.summary.length > 220 ? "…" : ""));
  if (wiki.url) console.log("  " + wiki.url);

  // Stash the pieces in the virtual filesystem for the next turn to pick up.
  var fs = require("fs");
  fs.writeFileSync("/tmp/country.json", JSON.stringify(country, null, 2));
  fs.writeFileSync("/tmp/weather.json", JSON.stringify(weather, null, 2));
  fs.writeFileSync("/tmp/wiki.json", JSON.stringify(wiki, null, 2));
'`);
process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write("[stderr] " + r.stderr);

// ── Turn 2: bash composes the report from saved JSON ────────────────────

console.log("\n--- Turn 2: bash composes a markdown report ---");
r = await bash.exec(`
  set -e
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  name=$(jq -r .name /tmp/country.json)
  capital=$(jq -r '.capital // "—"' /tmp/country.json)
  pop=$(jq -r .population /tmp/country.json)
  temp=$(jq -r .temperatureC /tmp/weather.json)
  wind=$(jq -r .windKph /tmp/weather.json)
  blurb=$(jq -r .summary /tmp/wiki.json | head -c 200)

  cat > /tmp/snapshot.md <<EOF
# $name

| Field | Value |
| --- | --- |
| Capital | $capital |
| Population | $pop |
| Capital weather | $temp °C, wind $wind km/h |

> $blurb …

_Generated: \${ts}_
EOF
  cat /tmp/snapshot.md
`);
process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write("[stderr] " + r.stderr);

// ── Turn 3: bash CLI form of the same tools ─────────────────────────────

console.log("\n--- Turn 3: same tools via the auto-generated bash CLI ---");
console.log("$ country lookup code=BR | jq -r '.name, .capital'");
r = await bash.exec(`country lookup code=BR | jq -r '.name, .capital'`);
process.stdout.write(r.stdout);

console.log("\n$ wiki summary title=Brazil | jq -r .title");
r = await bash.exec(`wiki summary title=Brazil | jq -r .title`);
process.stdout.write(r.stdout);

// ── Diagnostic: which tools were called ─────────────────────────────────

console.log("\n--- Diagnostic ---");
console.log(`Total tool calls: ${callLog.length}`);
for (const c of callLog) console.log(`  - ${c}`);

console.log("\nDone.");
