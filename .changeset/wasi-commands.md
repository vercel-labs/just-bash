---
"just-bash": minor
---

Add `defineWasmCommand` to run host-supplied WebAssembly binaries in Node.js and
browser workers, with no new third-party dependencies.

- Run WASI Preview 1 commands with the default adapter or `defineWasiCommand`.
- Connect other core WASM libraries through trusted JavaScript module adapters
  with explicit imports and virtual filesystem and stream access. Expose a
  bounded compiled module for SDKs that instantiate internally.
- Support shell arguments, exported environment, binary stdout, pipes, and
  redirections, with worker termination on timeout or cancellation and limits on
  module size, memory, tables, files, and output.
- Export `just-bash/wasm-worker` for browser bundlers, with
  `just-bash/wasi-worker` as an alias. Browser execution requires workers and
  cross-origin isolation for `SharedArrayBuffer`.

Document compatibility and limits, with a libfx agent from vercel-labs/fx and
a freestanding C library as examples. libfx is a dependency of its example only.
