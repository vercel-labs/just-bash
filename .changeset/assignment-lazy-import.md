---
"just-bash": patch
---

interpreter: avoid lazy import in variable assignment path that trips defense-in-depth (fixes #273)

Any non-`export` variable assignment (bare `SECRET=s`, prefixed `SECRET=s cmd`,
or before a custom command) failed with a defense-in-depth security violation
(`dynamic import of Node.js builtin 'node:module' is blocked during script
execution`), while plain commands and `export`-ed assignments passed.

`processScalarAssignment()` resolved `isArray` via `await import("./expansion.js")`
in two spots. In the bundled `dist`, that dynamic `import()` marks `expansion.js`
as a lazily-linked chunk whose `createRequire` banner imports `node:module`; the
defense layer's ESM `resolve` hook blocks that builtin import when the sandbox is
active and untrusted, so it blocked just-bash's own chunk load. The file already
statically imports from `./expansion.js`, so `isArray` is now pulled from that
static import and the two lazy imports are removed — no lazy `node:module`-bearing
chunk is linked at runtime. No public API change.
