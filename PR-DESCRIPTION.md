# Fix js-exec failing on both Bun and Node.js

Fixes #159

## Problem

`js-exec` commands hang for exactly `maxJsTimeoutMs` (default 10s) and exit with code 124 on every invocation, regardless of input complexity. Even `js-exec -c "console.log(42)"` fails.

**Affected runtimes**: Bun (all versions), Node.js LTS (intermittently, due to bug #1)

## Root Cause

Two independent bugs compound to break js-exec:

### Bug 1: Worker URL resolves to the wrong file after esbuild bundling

`js-exec.ts` references the worker via:

```ts
const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
```

After esbuild bundles `js-exec.ts` into `dist/bin/chunks/js-exec-XXXX.js`, the relative `./worker.js` resolves to `dist/bin/chunks/worker.js` at runtime -- which is the **Python worker** (copied there by `build:worker`). The js-exec worker exists as `dist/bin/chunks/js-exec-worker.js` but is never loaded.

The Python worker expects `workerData` (passed at `new Worker(path, { workerData })` constructor time). The js-exec protocol sends input via `postMessage()`. Since `workerData` is undefined, the Python worker does nothing and hangs until the timeout fires.

**Diagram of the name collision**:

```
build:worker script copies:
  python3/worker.js  --> dist/bin/chunks/worker.js          <-- Python protocol
  js-exec/worker.js  --> dist/bin/chunks/js-exec-worker.js  <-- js-exec protocol

js-exec.ts references:
  new URL("./worker.js", import.meta.url)
  --> resolves to: dist/bin/chunks/worker.js (Python!)
```

### Bug 2: Static import of `stripTypeScriptTypes` crashes Bun workers

`worker.ts` line 12:

```ts
import { stripTypeScriptTypes } from "node:module";
```

`stripTypeScriptTypes` is a Node.js 23.2+ experimental API. Bun's `node:module` does not export this symbol. Since this is a static ESM named import, it causes a link-time error that crashes the worker thread before any code runs:

```
SyntaxError: Export named 'stripTypeScriptTypes' not found in module 'node:module'.
```

## Fix

### Change 1: Rename worker output to avoid name collision (`js-exec.ts` + `package.json`)

```diff
- const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
+ const workerPath = fileURLToPath(new URL("./js-exec-worker.js", import.meta.url));
```

The `build:worker` script already produces `js-exec-worker.js` in the chunks directories. This change makes the source reference match.

The build script is also updated to output esbuild to `js-exec-worker.js` directly (instead of `worker.js` with a rename), keeping the source and build output consistent.

### Change 2: Dynamic require with fallback (`worker.ts`)

```diff
- import { stripTypeScriptTypes } from "node:module";
+ let stripTypeScriptTypes: (code: string) => string;
+ try {
+   const nodeModule = require("node:module");
+   stripTypeScriptTypes = nodeModule.stripTypeScriptTypes ?? ((code: string) => code);
+ } catch {
+   stripTypeScriptTypes = (code: string) => code;
+ }
```

Uses `require()` instead of `await import()` because Bun Worker threads load bundled `.js` files in a script context where top-level `await` is not supported (produces `"await is only valid in async functions"`).

When `stripTypeScriptTypes` is unavailable (Bun, older Node.js), the fallback returns the source code unmodified. TypeScript type stripping (`.ts`/`.mts` files, `--strip-types` flag) becomes unavailable, but plain JavaScript execution works normally -- which is the common case.

## Verification

All tests run against the built `dist/` output (not source), matching what npm consumers receive.

### Node.js v25.4.0

| Test | Result |
|------|--------|
| `js-exec -c "console.log(42)"` | exit=0, stdout=`"42"` |
| `require("fs").readFileSync` | exit=0, stdout=`"{\"k\":1}"` |
| `[1,2,3].reduce((a,b)=>a+b)` | exit=0, stdout=`"6"` |
| `.ts` file auto-detection | exit=0, stdout=`"42"` (stripTypeScriptTypes works) |

### Bun 1.3.11

| Test | Result |
|------|--------|
| `js-exec -c "console.log(42)"` | exit=0, stdout=`"42"` |
| `require("fs").readFileSync` | exit=0, stdout=`"{\"k\":1}"` |
| `[1,2,3].reduce((a,b)=>a+b)` | exit=0, stdout=`"6"` |
| `fs.writeFileSync` cross-call persistence | exit=0, stdout=`"hi"` |

**Before this fix**: 0% success rate (exit=124 timeout on every call).
**After this fix**: 100% success rate on both runtimes.

## Files Changed

| File | Lines | Description |
|------|-------|-------------|
| `src/commands/js-exec/js-exec.ts` | +1/-1 | Worker URL: `./worker.js` -> `./js-exec-worker.js` |
| `src/commands/js-exec/worker.ts` | +10/-1 | Static import -> `require()` with try/catch fallback |
| `package.json` | +1/-1 | `build:worker`: esbuild output to `js-exec-worker.js` |
| `.gitignore` | +1 | Add generated `js-exec-worker.js` |

## Notes

- The fix is backward compatible: on Node.js 23.2+, `stripTypeScriptTypes` is loaded normally via the dynamic import path
- No new dependencies added
- The Python worker (`worker.js`) path and behavior are unchanged
- On Bun, `.ts`/`.mts` execution will show the raw TypeScript source (type annotations are not stripped). This could be documented or addressed separately with a Bun-native TS strip implementation
- Uses `require()` instead of `await import()` because Bun Worker threads load bundled `.js` files in a script context where top-level `await` is not supported
