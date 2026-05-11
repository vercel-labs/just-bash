# @just-bash/executor

Experimental tool-invocation companion for [`just-bash`](../just-bash). Wires
`@executor-js/sdk` (and its GraphQL / OpenAPI / MCP plugins) into `just-bash`'s
generic `invokeTool` hook so JavaScript code running in `js-exec` can call
host-defined tools, and so those tools also appear as bash CLI commands.

> **Experimental.** This package is published under the `experimental` npm
> dist-tag and its API is expected to change. The `@executor-js/*` packages are
> optional peer dependencies; install `@executor-js/sdk` when using `setup`, and
> install the plugin packages for the source kinds you enable.

## Quick start

```ts
import { Bash } from "just-bash";
import { createExecutor } from "@just-bash/executor";

const executor = await createExecutor({
  tools: {
    "math.add": {
      description: "Add two numbers",
      execute: (args: { a: number; b: number }) => ({ sum: args.a + args.b }),
    },
  },
});

const bash = new Bash({
  javascript: { invokeTool: executor.invokeTool },
  customCommands: executor.commands,
});

await bash.exec(`js-exec -c '
  const r = await tools.math.add({ a: 3, b: 4 });
  console.log(r.sum); // 7
'`);

// Tools are also available as bash commands:
await bash.exec("math add a=1 b=2"); // → {"sum":3}
```

## Three surfaces, one tool

Every tool you register appears in three places, all derived from the same
`{ description, execute }` definition:

```text
"math.add": { description: "Add two numbers", execute: ({a,b}) => ({ sum: a+b }) }

→ Tool path:        math.add
→ JS in js-exec:    await tools.math.add({ a: 2, b: 3 })   // → { sum: 5 }
→ Bash CLI:         math add a=2 b=3                       // → {"sum":5}
                    echo '{"a":2,"b":3}' | math add        // → {"sum":5}
                    math add --json '{"a":2,"b":3}'        // → {"sum":5}
```

The same surfaces apply to tools discovered from GraphQL, OpenAPI, and MCP
sources — only the source of the registration differs.

## What it gives you

- **Inline tools** — define `{ description, execute }` maps directly
- **SDK-driven discovery** — register GraphQL endpoints, OpenAPI specs, or MCP
  servers and have tools auto-discovered
- **Approval and elicitation hooks** — gate which tools can run; handle
  user-input requests
- **Auto-generated bash commands** — tools become `namespace subcommand` bash
  commands (`gh`-style help, kebab-case, JSON/flag/stdin input)

## Installation

```bash
npm install just-bash @just-bash/executor

# For SDK-driven discovery:
npm install @executor-js/sdk

# Then whichever source plugins you use:
npm install @executor-js/plugin-graphql
npm install @executor-js/plugin-openapi
npm install @executor-js/plugin-mcp
```

## Inline tools

Define tools directly in the config — no SDK plugins required.

```ts
const executor = await createExecutor({
  tools: {
    "math.add": {
      description: "Add two numbers",
      execute: (args) => ({ sum: args.a + args.b }),
    },
    "db.query": {
      description: "Run a SQL query",
      execute: async (args) => {
        const rows = await queryDatabase(args.sql);
        return { rows };
      },
    },
  },
});
```

### Calling tools from `js-exec`

Tools are accessed through a global `tools` proxy. Property access builds the
tool path; calling invokes it:

```js
// Object return → JS gets a normal object
const r = await tools.math.add({ a: 3, b: 4 });
console.log(r.sum); // 7

// Array return
const data = await tools.db.query({ sql: "SELECT * FROM users" });
for (const row of data.rows) console.log(row.name);

// Primitive return → returned as-is
const ts = await tools.util.timestamp();
console.log(ts.ts);

// undefined return → JS gets undefined
const ack = await tools.cache.invalidate({ key: "u:1" });
console.log(ack); // undefined

// Thrown errors → catchable as Error in the script
try {
  await tools.math.divide({ a: 1, b: 0 });
} catch (e) {
  console.log("caught:", e.message);
}
```

Deeply nested paths work — `await tools.a.b.c.d()` invokes the tool registered
as `"a.b.c.d"`. Tool calls are synchronous under the hood (the worker blocks
via `Atomics.wait`), so `await` is technically a no-op — but it keeps code
portable between just-bash and the SDK's own runtimes.

### Tool definition shape

```ts
interface ToolDef {
  description?: string;
  execute: (args: unknown) => unknown; // sync or async
}
```

- `execute` receives the arguments object passed from the script
- Return value is JSON-serialized back to the script
- Returning `undefined` gives `undefined` in the script
- Throwing propagates to the script as a catchable exception
- `async` functions are awaited before returning to the script

## SDK-driven discovery

When you provide `setup`, `@just-bash/executor` boots `@executor-js/sdk` and
auto-discovers tools from your sources.

```ts
const executor = await createExecutor({
  setup: async (sdk) => {
    // GraphQL: introspects schema, registers one tool per query/mutation
    await sdk.sources.add({
      kind: "graphql",
      endpoint: "https://countries.trevorblades.com/graphql",
      name: "countries",
    });

    // OpenAPI: parses spec, registers one tool per operation
    await sdk.sources.add({
      kind: "openapi",
      spec: openApiSpecText,
      endpoint: "https://api.example.com",
      name: "myapi",
    });

    // MCP: connects to server, discovers tools from capabilities
    await sdk.sources.add({
      kind: "mcp",
      transport: "remote",
      endpoint: "https://mcp.example.com/sse",
      name: "internal",
    });
  },
});
```

Each source kind produces tool paths under its `name` namespace. Quick
reference:

| Source kind | Tool path                       | Args come from                       |
| ----------- | ------------------------------- | ------------------------------------ |
| `graphql`   | `<name>.query.<field>` / `<name>.mutation.<field>` | field args                       |
| `openapi`   | `<name>.<urlSegment>.<operationId>`                | path + query params + requestBody |
| `mcp`       | `<name>.<server-tool-name>`                        | the server tool's input schema    |
| inline      | the literal key in `tools: {…}` | the `args` parameter to `execute`    |

For step-by-step source-conversion guidance with copy-paste snippets, see
[`SKILL.md`](./SKILL.md) — written for AI agents but useful as a reference.

Mix inline `tools` and `setup` freely — both produce commands and route through
the same `invokeTool` callback. Inline tools win when paths conflict with
SDK-discovered ones.

## Approval and elicitation hooks

```ts
await createExecutor({
  setup: async (sdk) => { /* ... */ },
  onToolApproval: async (request) => {
    if (request.toolPath.startsWith("ops.")) {
      return { approved: false, reason: "ops tools need manual review" };
    }
    return { approved: true };
  },
  onElicitation: async (ctx) => {
    return { action: "decline" };
  },
});
```

`onToolApproval` is an adapter-level pre-invocation gate and defaults to
`"allow-all"`. SDK-native approval prompts and mid-tool user-input requests are
delivered through `onElicitation`, which defaults to declining all requests. Use
`"deny-all"` or a callback for stricter tool approval, and use `"accept-all"`
only for non-interactive elicitation flows you trust.

Approval metadata is intentionally conservative while this package is
experimental. In particular, `operationKind` may be `"unknown"`; prefer
decisions based on `toolPath`, `sourceId`, and `approvalLabel`.

## Tools as bash commands

By default, every registered tool also becomes a bash command. Each namespace
(the part of the path before the first `.`) becomes a top-level command and
the rest of the path becomes a subcommand.

### Naming rules

| Tool path             | Namespace command | Subcommand        | Aliases       |
| --------------------- | ----------------- | ----------------- | ------------- |
| `math.add`            | `math`            | `add`             | —             |
| `petstore.listPets`   | `petstore`        | `list-pets`       | `listPets`    |
| `petstore.getPetById` | `petstore`        | `get-pet-by-id`   | `getPetById`  |
| `docs.read_file`      | `docs`            | `read-file`       | `read_file`   |

Subcommand names are kebab-cased; the original form is registered as an alias
when it differs.

### Argument input modes

```bash
math add a=2 b=3                  # key=value
math add --a 2 --b 3              # --key value
math add --a=2 --b=3              # --key=value
math add --json '{"a":2,"b":3}'   # JSON via flag
echo '{"a":2,"b":3}' | math add   # JSON via stdin
math add --verbose                # bare flag → { verbose: true }
```

Values are coerced through `JSON.parse` first (so `a=2`, `--ok=true`,
`xs=[1,2]`, and `cfg='{"k":1}'` produce the natural JSON types) and fall back
to strings when parsing fails.

When more than one mode is used in a single invocation, the higher-precedence
mode wins:

```text
flags  >  --json  >  piped stdin
```

So `echo '{"a":1}' | math add --a=99` calls `math.add({ a: 99 })`.

### Output and exit codes

```text
$ math add a=2 b=3
{"sum":5}
                                  # exit 0; JSON to stdout, newline-terminated

$ math add a=2 b=3 | jq -r .sum
5                                 # composes with standard tools

$ math divide a=1 b=0
math: divide: divide by zero      # thrown error → stderr; exit 1

$ math nope
math: unknown command "nope"      # unknown subcommand → stderr; exit 1
Run 'math --help' for usage.
```

### Auto-generated help

`<namespace> --help` lists subcommands:

```text
$ math --help
Executor tools: math

USAGE
  math <command> [flags]

COMMANDS
  add       Add two numbers
  divide    Integer divide; throws on zero

EXAMPLES
  math add key=value
  math divide --key value

LEARN MORE
  math <command> --help
```

`<namespace> <subcommand> --help` shows input modes:

```text
$ math add --help
Add two numbers

USAGE
  math add [key=value ...]
  math add [--key value ...]
  math add --json '{...}'
  <stdin> | math add

FLAGS
  --json string    Pass all arguments as a JSON object
  --help           Show this help

EXAMPLES
  math add key=value
  math add --key value
  math add --json '{"key":"value"}'
  echo '{"key":"value"}' | math add
  math add key=value | jq -r .field
```

### Disabling

Pass `exposeToolsAsCommands: false` to `createExecutor` if you only want the
`tools` proxy in `js-exec` and no bash commands.

## Configuration reference

| Option | Type | Description |
| --- | --- | --- |
| `tools` | `Record<string, ToolDef>` | Inline tool definitions, keyed by dot-separated path |
| `setup` | `(sdk) => Promise<void>` | Async SDK initialization for tool discovery |
| `plugins` | `AnyPlugin[]` | Additional `@executor-js/sdk` plugins |
| `onToolApproval` | `"allow-all" \| "deny-all" \| fn` | Approval hook (default: `"allow-all"`) |
| `onElicitation` | `"accept-all" \| fn` | Elicitation hook (default: decline) |
| `exposeToolsAsCommands` | `boolean` | Register tools as bash commands (default: `true`) |

## Examples

See [`examples/executor-tools/`](../../examples/executor-tools/) for runnable
examples (`inline-tools.ts`, `multi-turn-discovery.ts`).

## How `invokeTool` works

The bridge between QuickJS (where your script runs) and the host (where your
tools execute) is just-bash's `invokeTool` callback on `JavaScriptConfig`. This
package produces an `invokeTool` that routes through the executor pipeline
(approval → invoke → elicitation), but you can write your own `invokeTool` for
any tool framework — it's a generic `(path, argsJson) => Promise<string>` hook.

```ts
new Bash({
  javascript: {
    invokeTool: async (path, argsJson) => {
      // path:     "math.add" (dot-separated)
      // argsJson: '{"a":1,"b":2}' (or "" for no args)
      // return:   JSON-stringified result, or "" for undefined
      // throw:    propagates as an exception inside the sandbox
    },
  },
});
```

`@just-bash/executor` is one consumer of this hook; raw maps, MCP clients, or
custom dispatchers are equally valid producers.
