---
"just-bash": patch
---

sqlite3: find the worker when the library is loaded through its CommonJS export

`sqlite3` failed with `sqlite3 worker failed to load` on every call after `require("just-bash")`. The worker was located from `import.meta.url`, which esbuild replaces with an empty object in `dist/bundle/index.cjs`. The module directory now comes from `__dirname` under CommonJS, and `chunks/sqlite3-worker.js` next to the bundle is a lookup location. A `require()` of the built bundle running `sqlite3` is now tested.
