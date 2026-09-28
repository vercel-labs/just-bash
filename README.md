# just-bash monorepo

This repository hosts the [`just-bash`](./packages/just-bash) package and its examples.

<p>
  <a href="https://vercel.com/labs#labs-products"><img alt="Vercel Labs Product" src="https://img.shields.io/badge/LABS-PRODUCT-0a0a0a.svg?style=for-the-badge&amp;logo=Vercel&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/just-bash"><img alt="npm version: just-bash" src="https://img.shields.io/npm/v/just-bash.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/npm/l/just-bash.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/just-bash"><img alt="npm downloads per month: just-bash" src="https://img.shields.io/npm/dm/just-bash.svg?style=for-the-badge&amp;labelColor=000000&amp;label=npm%20downloads" height="28"></a>
</p>

## Packages

| Package | Path | Description |
| --- | --- | --- |
| [`just-bash`](./packages/just-bash) | `packages/just-bash` | A simulated bash environment with virtual filesystem |

See the package's own [README](./packages/just-bash/README.md) for usage documentation.

## WebAssembly examples

Register WASI commands or WASM libraries with
[`defineWasmCommand`](./packages/just-bash/README.md#webassembly-commands).
The runtime adds no third-party dependencies.

| Example | Demonstrates |
| --- | --- |
| [libfx](./examples/libfx) | A WebAssembly agent from vercel-labs/fx, with prompts, virtual files, and pipelines |
| [WASM library](./examples/wasm-library) | A freestanding C library with a JavaScript adapter and custom imports |

## Layout

```
packages/         publishable npm packages
examples/         example consumers (bash-agent, cjs-consumer, website)
.github/          CI workflows
```

## Working in the repo

```bash
pnpm install              # install all workspace deps
pnpm build                # build all packages
pnpm test:run             # run unit + comparison tests
pnpm test:dist            # smoke-test the bundled output
pnpm lint                 # biome + per-package banned-pattern checks
pnpm typecheck            # tsc across all packages
```

Per-package commands run via `pnpm --filter <name> <script>` — e.g.
`pnpm --filter just-bash test:wasm`.
