# Executor Tools Example

Demonstrates executor tool invocation in just-bash. Sandboxed JavaScript code running in `js-exec` calls tools that fetch from real public APIs — no API keys needed.

## Run

```bash
cd examples/executor-tools
pnpm install
pnpm start
```

## What it shows

**Part 1 — Inline tools** (no `@executor/sdk` required):
1. **GraphQL tools** — Countries API queries exposed as `tools.countries.*`
2. **Utility tools** — `tools.util.timestamp()`, `tools.util.random()`
3. **Cross-tool scripts** — one js-exec script calling tools from multiple namespaces
4. **Tools + filesystem** — fetch data via tools, write to virtual fs, read with bash commands
5. **Error handling** — tool errors propagate as catchable exceptions

**Part 2 — Native SDK source discovery** (requires `@executor/sdk`):
- Shows the `executor.setup` callback pattern for auto-discovering tools from OpenAPI specs, GraphQL schemas, and MCP servers
- Includes `onToolApproval` for controlling which operations are allowed
