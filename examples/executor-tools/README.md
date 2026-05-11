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
npx tsx multi-api-agent.ts            # default country: JP
npx tsx multi-api-agent.ts BR         # override

# Or via main.ts
npx tsx main.ts 1          # inline tools
npx tsx main.ts 2          # SDK discovery
npx tsx main.ts 3          # multi-API agent loop
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

### Example 3: Multi-API Agent Loop (`multi-api-agent.ts`)

Three real public APIs (REST Countries, Open-Meteo, Wikipedia) are wrapped as inline executor tools and orchestrated across multiple turns to produce a "country snapshot" markdown report. Demonstrates the multi-source pattern from the upstream `@executor-js` examples — using inline tools instead of SDK-discovered ones, so it runs anywhere with no plugin dependencies.

1. **Parallel lookup** — One js-exec script fetches country, weather, and Wikipedia data in sequence and stashes JSON results in the virtual filesystem
2. **Bash composition** — A pure-bash heredoc reads the saved JSON via `jq` and writes a markdown report
3. **CLI surface** — The same tools are also auto-exposed as bash commands (`country lookup code=BR | jq -r .name`)

Pass a country code to override the default: `npx tsx multi-api-agent.ts US`.
