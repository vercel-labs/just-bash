# @just-bash/executor

Tool-invocation companion for [`just-bash`](../just-bash). Wires `@executor-js/sdk`
(and its GraphQL / OpenAPI / MCP plugins) into `just-bash`'s generic
`invokeTool` hook so JavaScript code running in `js-exec` can call host-defined
tools.

> **Experimental.** The shape may change in a future release. The
> `@executor-js/*` packages are declared as peer dependencies — `@executor-js/sdk`
> is required, the three plugin packages are optional peers.

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
npm install just-bash @just-bash/executor @executor-js/sdk
# Then whichever sources you use:
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
const result = await tools.math.add({ a: 3, b: 4 });
console.log(result.sum); // 7

const data = await tools.db.query({ sql: "SELECT * FROM users" });
for (const row of data.rows) console.log(row.name);
```

Deeply nested paths work — `await tools.a.b.c.d()` invokes the tool registered
as `"a.b.c.d"`. Tool calls are synchronous under the hood (the worker blocks
via `Atomics.wait`), so `await` is technically a no-op — but it keeps code
portable between just-bash and the SDK's own runtimes.

### Tool definition shape

```ts
{
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

Mix inline `tools` and `setup` freely — both produce commands and route through
the same `invokeTool` callback.

## Approval and elicitation hooks

```ts
await createExecutor({
  setup: async (sdk) => { /* ... */ },
  onToolApproval: async (request) => {
    if (request.operationKind === "delete") {
      return { approved: false, reason: "deletion not allowed" };
    }
    return { approved: true };
  },
  onElicitation: async (ctx) => {
    return { decision: "decline" };
  },
});
```

`onToolApproval` defaults to `"allow-all"`. `onElicitation` defaults to
declining all requests. Pass `"accept-all"` for either to auto-approve (not
recommended for untrusted tools).

## Tools as bash commands

By default, executor tools are also exposed as bash commands. Each namespace
becomes a command with kebab-cased subcommands:

```bash
math add a=1 b=2          # → tools.math.add({ a: 1, b: 2 })
petstore list-pets --status available
```

Disable this with `exposeToolsAsCommands: false`.

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
examples:

- `inline-tools.ts` — inline tool definitions, no SDK setup
- `multi-turn-discovery.ts` — SDK-driven discovery from a live GraphQL schema

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
