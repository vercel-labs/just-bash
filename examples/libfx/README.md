# libfx in just-bash

Run the WebAssembly build of [vercel-labs/fx](https://github.com/vercel-labs/fx)
as an `fx` shell command. Give it a prompt, pipe in context, read virtual files
through a tool, and redirect the answer:

```bash
echo "Keep it under 50 words." | fx "Read notes.md and summarize the release." > summary.md
cat summary.md
```

## Run

Use Node.js 24+. The start script enables JavaScript Promise Integration (JSPI)
with `--experimental-wasm-jspi` when the runtime needs it, as on Node.js 24.
When JSPI is enabled by default, it runs without that flag. You can also run
`main.mjs` directly on those versions.

From the repository root:

```bash
pnpm install
pnpm --filter just-bash build
AI_GATEWAY_API_KEY=your-key pnpm --filter libfx-example start
```

This makes a model request through Vercel AI Gateway. Set `FX_MODEL` to choose
a model; the example defaults to `google/gemini-2.5-flash-lite`. Output depends
on the model. `notes.md` and `summary.md` live in just-bash's virtual filesystem.

The example pins `libfx@0.0.10`. Only this example depends on libfx; the
just-bash package and its WASI runtime add no dependencies.

## How it works

`main.mjs` loads the package's `fx-core.wasm` and registers `fx-adapter.mjs`
with `defineWasmCommand`. Each invocation gets its own worker and agent, with
a two-minute deadline.

The adapter imports `createFxAgent` from `libfx/wasm` to select the WebAssembly
SDK explicitly. It passes `ctx.module`, which just-bash has compiled after
applying memory and function-table limits. The SDK instantiates that module
once and supplies its own WASI, JSPI, and `fx` host imports. JSPI lets WASM
suspend while waiting for model responses and host tools.

The adapter connects:

- The single prompt argument and optional stdin to `agent.prompt()`.
- Model text events to `ctx.stdout`, so pipes and redirections work normally.
- A `read_file` tool to `ctx.fs.readFile()`, with paths relative to the shell cwd.
- Explicit shell environment values to the SDK's API key and model options.

libfx owns its internal protocol I/O. Files reach the model through the
explicit `read_file` tool; shell stdin/stdout carry prompt context and answer
text. This is a small prompt command built with the SDK.

## Adapter responsibilities

The SDK and adapter are trusted JavaScript. The SDK uses the worker's `fetch`
for Gateway requests; just-bash's shell network configuration does not govern
those requests. Hosts can supply the SDK's `fetch` option to apply their own
network policy.

`ctx.module` retains the module's memory/table limits per instance. The adapter
must arrange for the SDK to create just one instance. SDK JavaScript allocations
and external requests are outside those module limits. The runner terminates
the worker on completion, timeout, or cancellation.

For an adapter that supplies imports directly, see the
[small C library example](../wasm-library/README.md). See also the
[WebAssembly API documentation](../../packages/just-bash/README.md#webassembly-commands).
