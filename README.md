# just-bash monorepo

This repository hosts the [`just-bash`](./packages/just-bash) package and its examples.

## Packages

| Package | Path | Description |
| --- | --- | --- |
| [`just-bash`](./packages/just-bash) | `packages/just-bash` | A simulated bash environment with virtual filesystem |

See the package's own [README](./packages/just-bash/README.md) for usage documentation.

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
