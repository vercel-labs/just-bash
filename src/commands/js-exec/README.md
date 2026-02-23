# js-exec

Sandboxed JavaScript and TypeScript runtime with small set of Node.js-compatible APIs. Code runs in a QuickJS sandbox with access to a virtual filesystem, HTTP, and shell execution.

## Quick Start

```bash
# Inline code
js-exec -c "console.log('hello world')"

# Run a file
js-exec script.js

# TypeScript (auto-detected from extension)
js-exec app.ts
```

## Usage

```
js-exec [OPTIONS] [-c CODE | FILE] [ARGS...]
```

| Flag | Description |
|------|-------------|
| `-c CODE` | Execute inline code |
| `-m`, `--module` | Enable ES module mode (`import`/`export`) |
| `--strip-types` | Strip TypeScript type annotations |
| `--version`, `-V` | Show version |
| `--help` | Show help |

File extensions are auto-detected:

| Extension | Module mode | TypeScript |
|-----------|-------------|------------|
| `.js` | no | no |
| `.mjs` | yes | no |
| `.ts` | yes | yes |
| `.mts` | yes | yes |
| `-c` (inline) | no (unless `-m` or top-level `await`) | no (unless `--strip-types`) |

## Node.js Compatibility

Code written for Node.js largely works here. Both `require()` and `import` are supported, the `node:` prefix works, and standard globals like `process`, `console`, and `fetch` are available. The key difference is that **all I/O is synchronous under the hood** — there are no event loops or async I/O. `fetch()` returns `Promise<Response>` for API compatibility but resolves immediately. `fs.promises` is also provided for API compatibility.

### fs

Available as a global, via `require('fs')`, or `import fs from 'node:fs'`.

**Reading and writing files**

```js
const fs = require('node:fs');

fs.readFileSync('/path/to/file')           // returns string
fs.writeFileSync('/path/to/file', 'data')
fs.appendFileSync('/path/to/file', 'more')
fs.copyFileSync('/src', '/dest')
fs.renameSync('/old', '/new')
fs.readFileBuffer('/path/to/file')         // returns number[] (raw bytes)
```

**Directories**

```js
fs.readdirSync('/path')                          // returns string[]
fs.mkdirSync('/path')
fs.mkdirSync('/path/to/deep', { recursive: true })
```

**Deleting**

```js
fs.rmSync('/path')
fs.rmSync('/dir', { recursive: true, force: true })
fs.unlinkSync('/path')                     // alias for rmSync
fs.rmdirSync('/path')                      // alias for rmSync
```

**Metadata**

```js
fs.statSync('/path')      // { isFile, isDirectory, isSymbolicLink, mode, size, mtime }
fs.lstatSync('/path')     // like stat but doesn't follow symlinks
fs.existsSync('/path')    // returns boolean
fs.realpathSync('/path')  // resolves symlinks
fs.chmodSync('/path', 0o755)
```

**Symbolic links**

```js
fs.symlinkSync('/target', '/link')
fs.readlinkSync('/link')   // returns target path
```

**Promises**

`fs.promises` wraps all methods for async/await compatibility:

```js
const data = await fs.promises.readFile('/path')
await fs.promises.writeFile('/path', 'content')
await fs.promises.access('/path')  // rejects if not found
```

Callback-style `fs.readFile(path, callback)` is **not supported** and throws an error.

### path

Available as a global, via `require('path')`, or `import path from 'node:path'`. POSIX-only.

```js
const path = require('node:path');

path.join('/a', 'b', 'c')           // "/a/b/c"
path.resolve('/a/b', '../c')        // "/a/c"
path.dirname('/a/b/c.txt')          // "/a/b"
path.basename('/a/b/c.txt')         // "c.txt"
path.basename('/a/b/c.txt', '.txt') // "c"
path.extname('file.js')             // ".js"
path.normalize('/a/b/../c')         // "/a/c"
path.relative('/a/b', '/a/c/d')     // "../c/d"
path.isAbsolute('/a')               // true
path.parse('/a/b/c.txt')            // { root, dir, base, ext, name }
path.format({ dir: '/a', base: 'b.txt' }) // "/a/b.txt"
path.sep                            // "/"
path.delimiter                      // ":"
```

### child_process

Available via `require('child_process')` or `import { execSync } from 'node:child_process'`.

```js
const { execSync, spawnSync } = require('node:child_process');

// execSync throws on non-zero exit, returns stdout
const output = execSync('echo hello');

// spawnSync returns { stdout, stderr, status }
const result = spawnSync('ls', ['-la']);
console.log(result.stdout);
```

### process

Available as a global or via `require('process')`.

```js
process.argv        // [scriptPath, ...args]
process.cwd()       // current working directory
process.exit(0)     // exit with code
process.env         // environment variables (e.g. process.env.HOME)
process.platform    // "linux"
process.arch        // "x64"
process.version     // "v22.0.0"
process.versions    // { node: "22.0.0", quickjs: "2024" }
```

## Other Globals

### console

```js
console.log("to stdout")
console.error("to stderr")
console.warn("to stderr")
```

### fetch

Standard Web Fetch API. Returns `Promise<Response>` (resolves immediately since I/O is synchronous under the hood):

```js
const response = await fetch("https://example.com");
const html = await response.text();

const response = await fetch("https://api.example.com/data", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "value" })
});
const data = await response.json();
```

Response properties: `status`, `statusText`, `ok`, `headers` (Headers), `url`, `body`, `bodyUsed`
Response methods: `text()`, `json()`, `clone()`
Static methods: `Response.json(data)`, `Response.error()`, `Response.redirect(url)`

### URL / URLSearchParams / Headers / Request

Standard Web API classes are available as globals:

```js
const url = new URL("https://example.com/path?q=1#hash");
console.log(url.hostname);              // "example.com"
console.log(url.searchParams.get("q")); // "1"

const headers = new Headers({ "Content-Type": "application/json" });
console.log(headers.get("content-type")); // "application/json" (case-insensitive)

const req = new Request("https://api.example.com", { method: "POST" });
const res = await fetch(req);
```

## Modules and Imports

Both `require()` and ES module `import` work. The `node:` prefix is supported.

```js
// CommonJS
const fs = require('node:fs');
const { join } = require('node:path');

// ES modules (requires -m flag, .mjs, .ts, .mts, or top-level await)
import fs from 'node:fs';
import { execSync } from 'node:child_process';
```

Available modules: `fs`, `path`, `child_process`, `process`, `console`.

Relative and absolute file imports work in module mode:

```js
import { greet } from './utils.mjs';
import config from '/home/user/config.mjs';
```

## TypeScript

TypeScript is auto-detected for `.ts` and `.mts` files. For inline code, use `--strip-types`. Type annotations, interfaces, type aliases, and generics are stripped. Runtime features like `enum` and `namespace` are not supported.

```bash
js-exec app.ts
js-exec --strip-types -c "const x: number = 5; console.log(x)"
```

## Limits

- **Memory**: 64 MB per execution
- **Timeout**: 30 seconds (configurable via `maxJsTimeoutMs`)
- **Engine**: QuickJS (compiled to WebAssembly)
