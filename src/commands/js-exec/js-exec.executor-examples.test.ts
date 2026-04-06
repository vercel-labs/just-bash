/**
 * Tests for executor tool examples.
 *
 * Uses a local HTTP server as a mock GraphQL API so the real @executor/sdk
 * pipeline is exercised end-to-end: source registration → schema introspection
 * → tool discovery → tool invocation — with zero network calls.
 *
 * defense-in-depth is disabled because Effect's runtime sets Error.stackTraceLimit,
 * which conflicts with the frozen Error constructor in defense-in-depth mode.
 */
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// ── Mock GraphQL data ────────────────────────────────────────────

const COUNTRIES: Record<string, any> = Object.create(null);
COUNTRIES["JP"] = {
  code: "JP", name: "Japan", capital: "Tokyo", currency: "JPY",
  emoji: "🇯🇵", emojiU: "U+1F1EF U+1F1F5", native: "日本",
  phone: "81", phones: ["81"], awsRegion: "ap-northeast-1",
  __typename: "Country",
  continent: { code: "AS", name: "Asia", __typename: "Continent", countries: [] },
  languages: [{ code: "ja", name: "Japanese", native: "日本語", rtl: false, __typename: "Language", countries: [] }],
  states: [], subdivisions: [], currencies: ["JPY"],
};
COUNTRIES["US"] = {
  code: "US", name: "United States", capital: "Washington D.C.", currency: "USD",
  emoji: "🇺🇸", emojiU: "U+1F1FA U+1F1F8", native: "United States",
  phone: "1", phones: ["1"], awsRegion: "us-east-2",
  __typename: "Country",
  continent: { code: "NA", name: "North America", __typename: "Continent", countries: [] },
  languages: [{ code: "en", name: "English", native: "English", rtl: false, __typename: "Language", countries: [] }],
  states: [], subdivisions: [], currencies: ["USD"],
};
COUNTRIES["AR"] = {
  code: "AR", name: "Argentina", capital: "Buenos Aires", currency: "ARS",
  emoji: "🇦🇷", emojiU: "U+1F1E6 U+1F1F7", native: "Argentina",
  phone: "54", phones: ["54"], awsRegion: "sa-east-1",
  __typename: "Country",
  continent: { code: "SA", name: "South America", __typename: "Continent", countries: [] },
  languages: [{ code: "es", name: "Spanish", native: "Español", rtl: false, __typename: "Language", countries: [] }],
  states: [], subdivisions: [], currencies: ["ARS"],
};
COUNTRIES["BR"] = {
  code: "BR", name: "Brazil", capital: "Brasília", currency: "BRL",
  emoji: "🇧🇷", emojiU: "U+1F1E7 U+1F1F7", native: "Brasil",
  phone: "55", phones: ["55"], awsRegion: "sa-east-1",
  __typename: "Country",
  continent: { code: "SA", name: "South America", __typename: "Continent", countries: [] },
  languages: [{ code: "pt", name: "Portuguese", native: "Português", rtl: false, __typename: "Language", countries: [] }],
  states: [], subdivisions: [], currencies: ["BRL"],
};

const ALL_COUNTRIES = Object.values(COUNTRIES);

const CONTINENTS: Record<string, any> = Object.create(null);
CONTINENTS["SA"] = {
  code: "SA", name: "South America", __typename: "Continent",
  countries: [COUNTRIES["AR"], COUNTRIES["BR"]],
};
CONTINENTS["AS"] = {
  code: "AS", name: "Asia", __typename: "Continent",
  countries: [COUNTRIES["JP"]],
};
CONTINENTS["NA"] = {
  code: "NA", name: "North America", __typename: "Continent",
  countries: [COUNTRIES["US"]],
};

const ALL_CONTINENTS = Object.values(CONTINENTS);

// ── Mock GraphQL server ──────────────────────────────────────────

const introspectionPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "fixtures",
  "countries-introspection.json",
);
const INTROSPECTION_RESPONSE = JSON.parse(fs.readFileSync(introspectionPath, "utf8"));

function handleGraphQL(query: string, variables: any): any {
  if (query.includes("__schema")) {
    return INTROSPECTION_RESPONSE;
  }
  // Match on the GraphQL operation name (e.g., "query QueryCountry", "query QueryCountries")
  const opMatch = query.match(/query\s+(Query\w+)/);
  const opName = opMatch?.[1] ?? "";

  if (opName === "QueryCountry") {
    return { data: { country: COUNTRIES[variables?.code] ?? null } };
  }
  if (opName === "QueryCountries") {
    const continentFilter = variables?.filter?.continent?.eq;
    const filtered = continentFilter
      ? ALL_COUNTRIES.filter((c: any) => c.continent.code === continentFilter)
      : ALL_COUNTRIES;
    return { data: { countries: filtered } };
  }
  if (opName === "QueryContinent") {
    return { data: { continent: CONTINENTS[variables?.code] ?? null } };
  }
  if (opName === "QueryContinents") {
    return { data: { continents: ALL_CONTINENTS } };
  }
  return { data: null };
}

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const result = handleGraphQL(parsed.query || "", parsed.variables);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(400);
        res.end("Bad Request");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as any).port;
});

afterAll(() => {
  server?.close();
});

function createBashWithSDK() {
  return new Bash({
    executionLimits: { maxJsTimeoutMs: 60000 },
    // Effect's runtime sets Error.stackTraceLimit which defense-in-depth blocks
    defenseInDepth: false,
    executor: {
      setup: async (sdk) => {
        await sdk.sources.add({
          kind: "graphql",
          endpoint: `http://127.0.0.1:${port}/graphql`,
          name: "countries",
          auth: { kind: "none" },
        });
      },
      onToolApproval: "allow-all",
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe("executor.setup: GraphQL tool discovery", () => {
  // Share one Bash instance — the SDK + QuickJS worker are process singletons
  const bash = createBashWithSDK();

  it("should discover source config in /.executor/config.json", async () => {
    const r = await bash.exec(`js-exec -c '
      var fs = require("fs");
      var raw = fs.readFileSync("/.executor/config.json", "utf8");
      var config = JSON.parse(raw);
      var sources = config.sources || {};
      var names = Object.keys(sources);
      console.log("count=" + names.length);
      console.log("name=" + names[0]);
      console.log("kind=" + sources[names[0]].kind);
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("count=1\nname=countries\nkind=graphql\n");
  });

  it("should call a discovered country tool", async () => {
    const r = await bash.exec(`js-exec -c '
      var result = await tools.countries.country({ code: "JP" });
      var c = result.data;
      console.log(c.name);
      console.log("capital=" + c.capital);
      console.log("region=" + c.awsRegion);
      console.log("continent=" + c.continent.name);
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      "Japan\ncapital=Tokyo\nregion=ap-northeast-1\ncontinent=Asia\n",
    );
  });

  it("should query countries list with filter", async () => {
    const r = await bash.exec(`js-exec -c '
      var result = await tools.countries.countries({
        filter: { continent: { eq: "SA" } }
      });
      var countries = result.data;
      console.log("count=" + countries.length);
      for (var i = 0; i < countries.length; i++) {
        console.log(countries[i].name + " — " + countries[i].capital);
      }
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      "count=2\nArgentina — Buenos Aires\nBrazil — Brasília\n",
    );
  });

  it("should chain multiple discovered tools", async () => {
    const r = await bash.exec(`js-exec -c '
      var contResult = await tools.countries.continents({});
      var continents = contResult.data;
      console.log("continents=" + continents.length);

      for (var i = 0; i < continents.length; i++) {
        var detailResult = await tools.countries.continent({ code: continents[i].code });
        var detail = detailResult.data;
        console.log(detail.name + ": " + detail.countries.length + " countries");
      }
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(
      [
        "continents=3",
        "South America: 2 countries",
        "Asia: 1 countries",
        "North America: 1 countries",
        "",
      ].join("\n"),
    );
  });

  it("should write discovered data to virtual filesystem", async () => {
    let r = await bash.exec(`js-exec -c '
      var fs = require("fs");
      var result = await tools.countries.countries({});
      var all = result.data;
      var lines = ["name,capital"];
      for (var i = 0; i < all.length; i++) {
        lines.push(all[i].name + "," + (all[i].capital || ""));
      }
      fs.writeFileSync("/tmp/countries.csv", lines.join("\\n"));
      console.log("wrote " + all.length);
    '`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("wrote 4\n");

    r = await bash.exec("cat /tmp/countries.csv");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(
      "name,capital\nJapan,Tokyo\nUnited States,Washington D.C.\nArgentina,Buenos Aires\nBrazil,Brasília",
    );
  });
});
