---
"just-bash": patch
---

python3: resolve the worker path without `import.meta`, so the CommonJS export can run Python

`python3` failed with `python3: Invalid URL` on every invocation when the library was loaded through its CommonJS export — `require("just-bash")`, and any framework that externalizes the package and loads it that way. The rest of the shell worked, so the failure read as a Python problem rather than a packaging one.

The worker was located with `new URL("./worker.js", import.meta.url)`, and `build:lib:cjs` runs esbuild with `--format=cjs`, which replaces `import.meta` with an empty object. The module directory now comes from `__dirname` under CommonJS and from `import.meta.url` otherwise, then the worker is looked up next to the module or one level down in `chunks/` — the two layouts it ships in. A missing worker now names the worker and the build step instead of surfacing as an invalid URL. Covered by the resolution order and by a `require()` of the built bundle running `python3`, which the suite had no test for.
