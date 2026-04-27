# Executor Tools (experimental)

> **Experimental.** The `experimental_executor` option is unstable and the
> shape may change in a future release. The `@executor-js/*` packages are
> declared as **optional peer dependencies** — install them yourself when you
> use this feature.

When the `Bash` constructor is given an `experimental_executor` config,
JavaScript code running in `js-exec` gets access to a `tools` proxy. Tool
calls are synchronous from the script's perspective — they block the QuickJS
sandbox while the host resolves them asynchronously.

Passing `experimental_executor` implicitly enables `javascript: true`, so you
don't need both.

## Installation

just-bash declares the executor packages as optional peer dependencies. Install
the ones you need alongside `just-bash`:

```bash
# Required for setup() / SDK-driven discovery
npm install @executor-js/sdk

# Plus whichever sources you use:
npm install @executor-js/plugin-graphql
npm install @executor-js/plugin-openapi
npm install @executor-js/plugin-mcp
```

Inline tools (the `tools` map) work without the SDK packages — those are only
needed when you provide `setup`.

## Inline tools

Define tools directly on the `Bash` constructor:

```ts
import { Bash } from "just-bash";

const bash = new Bash({
  experimental_executor: {
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
for (const row of data.rows) {
  console.log(row.name);
}
```

Deeply nested paths work — `await tools.a.b.c.d()` invokes the tool registered
as `"a.b.c.d"`. Tool calls are synchronous under the hood (the worker blocks
via `Atomics.wait`), so `await` on the return value is a no-op — but it keeps
code portable between just-bash and the SDK's own runtimes.

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
- Throwing an error propagates to the script as a catchable exception
- `async` functions are awaited on the host before returning to the script

The shape matches `@executor-js/sdk`'s `SimpleTool` type, so the same map can
be passed to both:

```ts
const tools = {
  "github.issues.list": {
    description: "List GitHub issues",
    execute: async (args) => { /* ... */ },
  },
};

const bash = new Bash({ experimental_executor: { tools } });
const executor = await createExecutor({ tools });
```

## SDK-driven discovery

When you provide `setup`, just-bash boots the `@executor-js/sdk` and routes
`js-exec` execution through the SDK pipeline. Use this to auto-discover tools
from GraphQL schemas, OpenAPI specs, or MCP servers.

```ts
const bash = new Bash({
  experimental_executor: {
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

      // MCP via stdio (local process)
      await sdk.sources.add({
        kind: "mcp",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        name: "fs",
      });

      // Custom: inline tool definitions registered through the SDK
      await sdk.sources.add({
        kind: "custom",
        name: "utils",
        tools: {
          getUser: {
            description: "Get user",
            execute: (args) => fetchUser(args.id),
          },
        },
      });
    },
  },
});
```

You can mix inline `tools` and `setup` — both sets are exposed through the
same `tools` proxy and as bash commands.

## Approval and elicitation hooks

```ts
new Bash({
  experimental_executor: {
    onToolApproval: async (request) => {
      if (request.operationKind === "delete") {
        return { approved: false, reason: "deletion not allowed" };
      }
      return { approved: true };
    },
    onElicitation: async (ctx) => {
      // Return user-supplied values, or decline
      return { decision: "decline" };
    },
  },
});
```

`onToolApproval` defaults to `"allow-all"`. `onElicitation` defaults to
declining all requests. Pass `"accept-all"` for either to auto-approve (not
recommended for untrusted tools).

## Tools as bash commands

By default, executor tools are also registered as bash commands. Each
namespace becomes a command with kebab-cased subcommands:

```bash
math add a=1 b=2          # → tools.math.add({ a: 1, b: 2 })
petstore list-pets --status available
```

Disable this with `exposeToolsAsCommands: false` if you only want script-level
access.

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

See [`examples/executor-tools/`](../../../examples/executor-tools/) for
runnable examples:

- `inline-tools.ts` — inline tool definitions, no SDK required
- `multi-turn-discovery.ts` — SDK-driven discovery from a live GraphQL schema
