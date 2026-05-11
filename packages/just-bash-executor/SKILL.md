---
name: just-bash-executor
description: Convert a GraphQL endpoint, OpenAPI spec, or MCP server into bash CLI commands and a `tools.*` JS API runnable inside `just-bash`'s `js-exec` sandbox. Use when the user wants to expose a remote API to a sandboxed bash agent, build a tool-calling agent on top of just-bash, or generate CLI commands from an existing API spec.
---

# `@just-bash/executor` — agent guide

This file is for an AI agent writing code that uses `@just-bash/executor`. It
maps each input (an OpenAPI spec, a GraphQL endpoint, an MCP server, or your
own JS functions) to the exact code to write and the exact surfaces (JS API +
bash CLI) the user gets back.

Read top to bottom on the first task; jump by section number on later tasks.

## §1. Decide which source kind you have

```text
Have an OpenAPI spec / Swagger doc?     → §3 OpenAPI
Have a GraphQL endpoint or SDL?         → §4 GraphQL
Have an MCP server (URL or stdio)?      → §5 MCP
Defining tools yourself in code?        → §2 Inline
Mixing several of the above?            → call sources.add() once per source
                                          inside the same setup(); paths stay
                                          namespaced by `name`
```

For all four, the consuming code is identical (§6, §7) — what changes is the
`createExecutor` config.

## §2. Inline tools

Use when there's no upstream spec — the user wants to expose specific JS
functions to the sandbox.

```ts
import { Bash } from "just-bash";
import { createExecutor } from "@just-bash/executor";

const executor = await createExecutor({
  tools: {
    "ns.action": {
      description: "What it does",
      execute: async (args: { /* shape */ }) => ({ /* JSON-serializable */ }),
    },
  },
});

const bash = new Bash({
  customCommands: executor.commands,
  javascript: { invokeTool: executor.invokeTool },
});
```

Conversion (single rule):

```text
key in tools: {…}      JS                          bash
"ns.action"      →     await tools.ns.action(args) ns action key=value
                                                    ns action --key value
                                                    ns action --json '{"key":1}'
```

The first dot-segment is the namespace command; the rest is the subcommand
(kebab-cased, with the original form as an alias when different).

## §3. OpenAPI → tools

Ask the user for: spec source, base endpoint, namespace `name`, and optional
auth headers.

The `spec` field accepts three forms:

```ts
spec: "https://petstore3.swagger.io/api/v3/openapi.json"  // URL — fetched at setup
spec: fs.readFileSync("./openapi.yaml", "utf8")          // YAML text
spec: JSON.stringify(specObject)                          // JSON text
```

For authenticated APIs, pass `headers` (and optionally `queryParams`):

```ts
await sdk.sources.add({
  kind: "openapi",
  spec: "https://api.github.com/openapi.json",
  endpoint: "https://api.github.com",
  name: "github",
  headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  },
});
```

Full inline example:

```ts
import { createExecutor } from "@just-bash/executor";
import { Bash } from "just-bash";

// `spec` is the raw OpenAPI document as a STRING (JSON or YAML text),
// not a parsed object. Read it from disk if you have a file.
const PETSTORE_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Petstore", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "ok" } },
      },
      post: {
        operationId: "createPet",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": { description: "ok" } },
      },
    },
    "/pets/{petId}": {
      get: {
        operationId: "getPetById",
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
  },
});

const executor = await createExecutor({
  setup: async (sdk) => {
    await sdk.sources.add({
      kind: "openapi",
      spec: PETSTORE_SPEC,
      endpoint: "https://petstore.example.com",
      name: "pets",            // becomes the namespace
    });
  },
  onToolApproval: "allow-all",
});

const bash = new Bash({
  customCommands: executor.commands,
  javascript: { invokeTool: executor.invokeTool },
});
```

Conversion rules:

- One tool per operation in the spec
- Tool path: `<name>.<firstUrlSegment>.<operationId>` — the first URL path
  segment is included as a grouping prefix (camelCase preserved on the operationId)
- Args object = path params + query params + requestBody fields, flattened
- Bash subcommand: kebab-case of `<firstUrlSegment>.<operationId>`; original
  camelCase form is kept as an alias

Example (from the spec above — all under `/pets/*`):

```text
operationId      → tool path                 JS call                                                  bash
listPets         → pets.pets.listPets        await tools.pets.pets.listPets({ status })               pets pets.list-pets --status open
createPet        → pets.pets.createPet       await tools.pets.pets.createPet({ name })                pets pets.create-pet --name Fido
getPetById       → pets.pets.getPetById      await tools.pets.pets.getPetById({ petId })              pets pets.get-pet-by-id --pet-id 42
```

(The double `pets.pets` looks awkward but is deterministic: the first `pets`
is your `name`, the second is the URL's first path segment.)

Pitfalls:

- `spec` must be a **string** (URL, JSON text, or YAML text), not a parsed object
- Operations missing `operationId` are skipped; if the user's spec lacks them,
  add them or fall back to inline tools
- All param locations (path, query, body) flatten into one args object — name
  collisions across locations are the user's problem to resolve
- `headers` are sent on every invocation — fine for static tokens, but for
  per-request auth wire an inline tool that adds the header dynamically
- The plugin is loaded lazily via `setup`; install `@executor-js/plugin-openapi`
  alongside `@executor-js/sdk` or `createExecutor` will throw

## §4. GraphQL → tools

Ask the user for: endpoint URL, optional introspection JSON, a namespace `name`,
and optional auth headers.

```ts
const executor = await createExecutor({
  setup: async (sdk) => {
    await sdk.sources.add({
      kind: "graphql",
      endpoint: "https://api.github.com/graphql",
      name: "github",
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
      // Optional: pre-fetched schema; skips the introspection round-trip and
      // lets discovery work offline. Recommended for unstable upstreams.
      // introspectionJson: INTROSPECTION_JSON,
    });
  },
  onToolApproval: "allow-all",
});
```

Conversion rules:

- One tool per top-level Query and Mutation field
- Tool path: `<name>.query.<fieldName>` for queries and
  `<name>.mutation.<fieldName>` for mutations (camelCase preserved)
- Args object = the field's argument definitions
- Result is the raw GraphQL response envelope: `{ status, data, errors }`.
  Scripts must check `errors` and read `data` themselves — there is no
  auto-unwrap.
- The plugin auto-generates a shallow selection set. Queries whose return
  types contain nested object fields will fail server-side validation
  ("Field X of type Y must have a selection of subfields"). For these,
  wrap the call in an inline tool that posts a hand-written GraphQL query
  via `fetch` instead of going through the SDK plugin.
- Subscriptions are not currently exposed as callable tools

Example, from the public Countries schema (all queries):

```text
Query field      → tool path                JS call                                                            bash
country(code)    → geo.query.country        await tools.geo.query.country({ code: "JP" })                      geo query.country code=JP
countries(filter)→ geo.query.countries      await tools.geo.query.countries({ filter: { ... } })               geo query.countries --json '{"filter":{...}}'
continent(code)  → geo.query.continent      await tools.geo.query.continent({ code: "EU" })                    geo query.continent code=EU
continents       → geo.query.continents     await tools.geo.query.continents({})                               geo query.continents
language(code)   → geo.query.language       await tools.geo.query.language({ code: "en" })                     geo query.language code=en
languages        → geo.query.languages      await tools.geo.query.languages({})                                geo query.languages
```

Reading the response in a script:

```js
const r = await tools.geo.query.country({ code: "JP" });
if (r.errors && r.errors.length) {
  throw new Error(r.errors.map((e) => e.message).join("; "));
}
const country = r.data.country;
console.log(country.name);
```

Pitfalls:

- Required GraphQL args (`String!`, `ID!`) must be passed; the SDK surfaces
  validation errors as thrown exceptions inside scripts — wrap calls in
  `try/catch` if the agent might call with empty args
- For complex `filter`/input-object args, prefer `--json` over `key=value`
- `headers` apply to introspection AND every tool call — useful for tokens,
  but don't put per-user identity here
- Install `@executor-js/plugin-graphql` alongside `@executor-js/sdk`

## §5. MCP → tools

Ask the user for: transport (`"remote"` or `"stdio"`), endpoint URL or
command+args, a namespace `name`.

```ts
const executor = await createExecutor({
  setup: async (sdk) => {
    // Remote (SSE / HTTP)
    await sdk.sources.add({
      kind: "mcp",
      transport: "remote",
      endpoint: "https://mcp.example.com/sse",
      name: "docs",
    });

    // Remote with auth headers
    await sdk.sources.add({
      kind: "mcp",
      transport: "remote",
      endpoint: "https://mcp.context7.com/mcp",
      name: "context7",
      headers: {
        Authorization: `Bearer ${process.env.CONTEXT7_TOKEN}`,
      },
    });

    // Stdio (local process) — env vars and cwd are passed to the child
    await sdk.sources.add({
      kind: "mcp",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      env: { LOG_LEVEL: "info" },
      cwd: "/work",
      name: "fs",
    });
  },
  onToolApproval: async (req) => {
    // MCP servers can do destructive things — gate by tool path
    if (req.toolPath.endsWith(".write_file")) {
      return { approved: false, reason: "writes need review" };
    }
    return { approved: true };
  },
  onElicitation: async (ctx) => {
    // MCP servers may request user input mid-tool (forms, OAuth URLs).
    // Decline by default; implement a real handler for interactive flows.
    return { action: "decline" };
  },
});
```

Conversion rules:

- One tool per tool advertised by the MCP server's `tools/list` capability
- Tool path: `<name>.<server-tool-name>` — server tool names are preserved
  verbatim (often `snake_case` like `read_file`)
- Args object = the MCP tool's input schema
- Subcommand: server tool name → kebab-case; original (snake_case or otherwise)
  is kept as an alias when different

Example (filesystem-style MCP server with `read_file`, `list_dir`):

```text
server tool   → tool path        JS call                                       bash kebab                        bash snake alias
read_file     → fs.read_file     await tools.fs.read_file({ path: "/x.md" })   fs read-file path=/x.md           fs read_file path=/x.md
list_dir      → fs.list_dir      await tools.fs.list_dir({ path: "/" })        fs list-dir path=/                fs list_dir path=/
```

Pitfalls:

- `transport: "remote"` requires `endpoint`; `transport: "stdio"` requires
  `command` + `args`
- MCP servers with elicitation flows need an `onElicitation` handler other
  than the default decline-all, otherwise interactive tools will fail
- Install `@executor-js/plugin-mcp` alongside `@executor-js/sdk`

## §5b. Combining multiple sources in one executor

Real agents usually need more than one upstream. Add as many `sources.add()`
calls as you want inside the same `setup`; each registers its own namespace and
tools land in a single unified `tools` proxy / bash command set.

```ts
const executor = await createExecutor({
  setup: async (sdk) => {
    // OpenAPI from a URL (no auth)
    await sdk.sources.add({
      kind: "openapi",
      spec: "https://petstore3.swagger.io/api/v3/openapi.json",
      name: "petstore",
    });

    // GraphQL with bearer auth
    await sdk.sources.add({
      kind: "graphql",
      endpoint: "https://api.github.com/graphql",
      name: "github",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    });

    // Remote MCP for context lookups
    await sdk.sources.add({
      kind: "mcp",
      transport: "remote",
      endpoint: "https://mcp.example.com/sse",
      name: "context",
    });
  },
  // Inline tools coexist with discovered ones; inline wins on path conflict.
  tools: {
    "util.now": {
      description: "Wall-clock ISO timestamp",
      execute: () => ({ ts: new Date().toISOString() }),
    },
  },
  onToolApproval: async (req) => {
    // Different policy per source
    if (req.sourceId === "github" && req.toolPath.includes("delete")) {
      return { approved: false, reason: "github deletes need review" };
    }
    return { approved: true };
  },
});
```

A js-exec script can then call across all sources in one turn. Remember the
shape per source kind: GraphQL paths are `<name>.query.<field>`, OpenAPI paths
are `<name>.<firstUrlSegment>.<operationId>`, MCP paths are
`<name>.<server-tool-name>`, inline paths are exactly your key.

```js
const repos = await tools.github.query.search({ query: "stars:>10000", type: "REPOSITORY" });
const pet   = await tools.petstore.pet.findPetById({ petId: 1 });
const ctx   = await tools.context.lookup({ name: "react" });
const ts    = await tools.util.now();
// GraphQL responses are wrapped — unwrap before reading
console.log({
  repos: repos.data?.search?.repositoryCount ?? null,
  pet, ctx, ts,
});
```

Use distinct `name` values per source — collisions silently overwrite tool
paths within the namespace.

## §6. Calling generated tools — the rules to internalize

These two tables are the only things you need to memorize. They apply to all
four source kinds — the conversion is uniform.

### JS API (inside `js-exec` scripts)

| Want                      | Write                                          |
| ------------------------- | ---------------------------------------------- |
| Call any tool             | `await tools.<namespace>.<name>(args)`         |
| Pass no args              | `await tools.ns.name()` or `({})`              |
| Catch tool errors         | `try { ... } catch (e) { e.message }`          |
| Snake-case server tool    | `await tools.docs["read_file"]({ path })`      |
| Deeply nested path        | `await tools.a.b.c.d(args)` — works as written |

`undefined` returns reach the script as `undefined`; everything else is
JSON-serialized and parsed back into a JS value.

### Bash CLI (inside `bash.exec(...)` scripts)

| Want                | Write                                   |
| ------------------- | --------------------------------------- |
| key=value           | `ns name a=1 b=2`                       |
| flags               | `ns name --a 1 --b 2`                   |
| `--key=value`       | `ns name --a=1`                         |
| Bool flag           | `ns name --verbose` → `{verbose: true}` |
| Inline JSON         | `ns name --json '{"a":1,"b":2}'`        |
| Piped JSON          | `echo '{"a":1}' \| ns name`             |
| Compose with jq     | `ns name a=1 \| jq -r .field`           |
| Show help           | `ns --help` or `ns name --help`         |

Mode precedence when more than one is used: **flags > `--json` > stdin**.

Values are coerced via `JSON.parse` first (`a=2` → number `2`,
`ok=true` → boolean `true`, `xs=[1,2]` → array), falling back to string when
parsing fails.

Tool errors land on stderr with format `<namespace>: <subcommand>: <message>`
and exit code 1.

## §7. Skeleton an agent can copy and adapt

Self-contained — pick a source kind, fill in the spec, run with `tsx`.

```ts
import { Bash } from "just-bash";
import { createExecutor } from "@just-bash/executor";

const executor = await createExecutor({
  // Pick ONE of: `tools` (inline) or `setup` (SDK), or both.
  tools: {
    "math.add": {
      description: "Add two numbers",
      execute: ({ a, b }: { a: number; b: number }) => ({ sum: a + b }),
    },
  },
  // setup: async (sdk) => {
  //   await sdk.sources.add({ kind: "openapi", spec, endpoint, name });
  // },
  onToolApproval: "allow-all",
});

const bash = new Bash({
  customCommands: executor.commands,
  javascript: { invokeTool: executor.invokeTool },
  executionLimits: { maxJsTimeoutMs: 30_000 },
});

// 1. JS API
const r1 = await bash.exec(`js-exec -c '
  try {
    const r = await tools.math.add({ a: 2, b: 3 });
    console.log("sum=" + r.sum);
  } catch (e) {
    console.error("tool failed:", e.message);
  }
'`);
process.stdout.write(r1.stdout);
if (r1.stderr) process.stderr.write(r1.stderr);

// 2. Bash CLI — three input modes, all equivalent
for (const cmd of [
  "math add a=2 b=3",
  "math add --a 2 --b 3",
  `echo '{"a":2,"b":3}' | math add`,
]) {
  const r = await bash.exec(cmd);
  console.log(`${cmd}  →  ${r.stdout.trim()}  (exit=${r.exitCode})`);
}

// 3. Help text
process.stdout.write((await bash.exec("math --help")).stdout);
```

## §8. Verification before reporting "done"

Run these checks in order. Stop at the first failure.

1. **Exec works.** A simple call returns exit 0 with parseable JSON on stdout:
   ```ts
   const r = await bash.exec(`<ns> <subcommand> <args>`);
   JSON.parse(r.stdout);  // should not throw
   ```
2. **Wrong path errors clearly.** `await tools.ns.nope({})` throws with
   `Unknown tool` in the message — confirms dispatch is wired.
3. **Help reflects discovery.** `bash.exec("<ns> --help")` lists every tool
   the user expected. If a tool's missing, the source registration didn't pick
   it up (most often: missing `operationId` for OpenAPI; subscription field
   for GraphQL; capability not advertised for MCP).
4. **Inspect via SDK handle (when `setup` was used):**
   ```ts
   // List everything
   const all = await executor.sdk!.tools.list();
   console.log(all.map(t => t.id));

   // Filter by source
   const ghOnly = await executor.sdk!.tools.list({ sourceId: "github" });

   // Search descriptions/names
   const writes = await executor.sdk!.tools.list({ query: "create" });
   ```
5. **Approval gates work.** If you wired `onToolApproval`, deny one path and
   confirm the call throws inside `js-exec` rather than silently succeeding.

## §9. Anti-patterns

- **Don't pass parsed objects to `kind: "openapi"`.** `spec` is a string
  (JSON or YAML text). Use `JSON.stringify(...)` or `fs.readFileSync(path, "utf8")`.
- **Don't put tool logic inside the `js-exec` script.** `execute` runs on the
  host; the script just calls it. Putting fetches or DB calls in the script
  defeats the sandbox.
- **Don't rely on `await` doing real async work.** Tool calls are synchronous
  via `Atomics.wait` from the script's perspective; `await` is for portability
  with other runtimes.
- **Don't expose host-FS or shell tools without an `onToolApproval` gate.**
  The default `"allow-all"` is fine for read-only or pure-compute tools; for
  anything destructive, gate by `toolPath`.
- **Don't reuse a namespace across sources.** Two `sources.add` calls with the
  same `name` will collide. Use distinct names per source.
- **Don't skip installing the plugin package.** `@executor-js/sdk` alone is not
  enough — each source kind requires its plugin (`@executor-js/plugin-openapi`,
  `…-graphql`, `…-mcp`).

## §10. Cross-references

- [`README.md`](./README.md) — conceptual overview, configuration reference
- [`examples/executor-tools/`](../../examples/executor-tools/) — runnable
  end-to-end examples (`inline-tools.ts`, `multi-turn-discovery.ts`)
- [`@executor-js/sdk`](https://www.npmjs.com/package/@executor-js/sdk) —
  upstream SDK whose plugins drive discovery
