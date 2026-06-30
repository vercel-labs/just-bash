---
"just-bash": patch
---

fix(sqlite3): handle Bun structured-clone surfacing `null` as zero-length `ArrayBuffer`

Bun's `worker_threads` structured-clone has regressed across versions (notably the build shipped in Trigger.dev's container) and surfaces a host-side `null` `dbBuffer` as a zero-length `ArrayBuffer` inside the worker. The prior `if (data.dbBuffer)` guard treated that as truthy, so `new SQL.Database(arrayBuffer)` ran with a bare `ArrayBuffer` — which sql.js rejects with `Expected ArrayBuffer for the first argument` (it wants `Uint8Array`).

Route the buffer through a `coerceDbBuffer` helper that:

- returns a `Uint8Array` as-is (covers `Buffer` too, which extends `Uint8Array`),
- wraps a non-empty `ArrayBuffer` in a `Uint8Array`,
- and returns `null` for `null` / `undefined` / zero-length buffers — letting `executeQuery` fall back to `new SQL.Database()` (fresh in-memory db), which matches the host's intent for `:memory:` databases.

No behavior change under Node; fixes `:memory:` invocations under affected Bun builds.
