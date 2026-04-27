# Executor Tools Examples

Demonstrates executor tool invocation in just-bash. Sandboxed JavaScript code running in `js-exec` calls tools that fetch from real public APIs — no API keys needed.

## Run

```bash
cd examples/executor-tools
pnpm install

# Run all examples
pnpm start

# Run a specific example
npx tsx inline-tools.ts
npx tsx multi-turn-discovery.ts

# Or via main.ts
npx tsx main.ts 1          # inline tools
npx tsx main.ts 2          # SDK discovery
```

## Examples

### Example 1: Inline Tools (`inline-tools.ts`)

Defines tools directly in the `Bash` constructor — no SDK required.

1. **GraphQL tools** — Countries API queries exposed as `tools.countries.*`
2. **Utility tools** — `tools.util.timestamp()`, `tools.util.random()`
3. **Cross-tool scripts** — one js-exec script calling tools from multiple namespaces
4. **Tools + filesystem** — fetch data via tools, write to virtual fs, read with bash commands
5. **Error handling** — tool errors propagate as catchable exceptions

### Example 2: Multi-Turn Tool Discovery (`multi-turn-discovery.ts`)

Uses `experimental_executor.setup` with the real `@executor/sdk` to auto-discover tools from a live GraphQL schema — no inline tool definitions. The SDK introspects the countries API and registers one tool per query type.

1. **Discover** — Agent reads `/.executor/config.json` to see registered sources
2. **Use** — Agent calls a discovered tool (`tools.countries.country({ code: "JP" })`)
3. **Filter** — Agent queries a list endpoint with filters (`tools.countries.countries()`)
4. **Chain** — Agent chains multiple tools: continents → countries per continent
5. **Persist** — Agent writes all 250 countries as CSV to the virtual filesystem
