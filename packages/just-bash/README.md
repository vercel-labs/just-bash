# just-bash

A virtual bash environment with an in-memory filesystem, written in TypeScript and designed for AI agents.

Broad support for standard unix commands and bash syntax with optional curl, Python, JS/TS, and sqlite support.

**Note**: This is beta software. Use at your own risk and please provide feedback. See [security model](#security-model).

## Quick Start

```bash
npm install just-bash
```

```typescript
import { Bash } from "just-bash";

const bash = new Bash();
await bash.exec('echo "Hello" > greeting.txt');
const result = await bash.exec("cat greeting.txt");
console.log(result.stdout); // "Hello\n"
console.log(result.exitCode); // 0
```

Each `exec()` call gets its own isolated shell state — environment variables, functions, and working directory reset between calls. The **filesystem is shared** across calls, so files written in one `exec()` are visible in the next.

## Custom Commands

Extend just-bash with your own TypeScript commands using `defineCommand`:

```typescript
import { Bash, decodeBytesToUtf8, defineCommand } from "just-bash";

const hello = defineCommand("hello", async (args, ctx) => {
  const name = args[0] || "world";
  return { stdout: `Hello, ${name}!\n`, stderr: "", exitCode: 0 };
});

const upper = defineCommand("upper", async (args, ctx) => {
  // ctx.stdin is a ByteString — decode to text before string ops.
  return {
    stdout: decodeBytesToUtf8(ctx.stdin).toUpperCase(),
    stderr: "",
    exitCode: 0,
  };
});

const bash = new Bash({ customCommands: [hello, upper] });

await bash.exec("hello Alice"); // "Hello, Alice!\n"
await bash.exec("echo 'test' | upper"); // "TEST\n"
```

Custom command callbacks receive a `ResolvedCommandContext` with `fs`, `cwd`,
`env`, `stdin`, resolved `limits`, and `exec` (for subcommands), and work with
pipes, redirections, and all shell features. The legacy `CommandContext` remains
available for standalone context inputs; use `createCommandContext({ fs })` when
calling a command directly with a fully resolved context.

Host-provided commands preserve the legacy trusted default whether supplied to
the `Bash` constructor, declared through `defineCommand`, loaded lazily, or
added later with `bash.registerCommand()`. Set `trusted: false` (or use
`defineCommand(name, execute, { trusted: false })`) to select the restricted
extension boundary. Trusted commands run in the embedding process and should
never execute guest-provided JavaScript.

Every invocation is bound by `maxExecutionTimeMs`. On cancellation, just-bash
revokes the command context immediately; `maxExtensionCleanupTimeMs` only
bounds how long it waits for the now-authority-free command promise to settle.
A late continuation cannot use `ctx.fs`, `ctx.env`, `ctx.exec`, or other context
capabilities. Cleanup work that must run at scope closure can be registered with
`ctx.executionScope.registerCleanup()`. A cleanup failure is returned as a
generic exit-126 shell result rather than rejecting `Bash.exec()` or exposing
host error details. JavaScript cannot forcibly stop arbitrary host code, so
extensions requiring a hard guarantee against external side effects must run
in a terminable worker or process. Tests that invoke command objects directly
can use `createCommandContext({ fs })` to get a fully resolved context without
duplicating internal defaults.

## WebAssembly Commands

Register a WebAssembly binary with `defineWasmCommand`. WASI Preview 1 commands
work by default; libraries with other interfaces use an explicit adapter.
Each invocation runs in a disposable worker with a deadline and memory limits.
The WASM runner and WASI adapter are implemented in this repository and add no
third-party dependencies.

### Example: libfx

Run the WebAssembly agent from [vercel-labs/fx](https://github.com/vercel-labs/fx)
as a shell command. The [libfx example](https://github.com/vercel-labs/just-bash/tree/main/examples/libfx)
includes the adapter and setup instructions for Node.js with JSPI enabled.
Install `libfx@0.0.10` in the consuming application to use its SDK and binary:

```typescript
import { readFile } from "node:fs/promises";
import { Bash, defineWasmCommand } from "just-bash";

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error("Set AI_GATEWAY_API_KEY");
const wasmUrl = new URL("./fx-core.wasm", import.meta.resolve("libfx/wasm"));
const bash = new Bash({
  cwd: "/project",
  env: { AI_GATEWAY_API_KEY: apiKey, FX_MODEL: "google/gemini-2.5-flash-lite" },
  files: { "/project/notes.md": "WASM commands support pipes and virtual files.\n" },
  executionLimits: { maxExecutionTimeMs: 120_000 },
  customCommands: [
    defineWasmCommand("fx", {
      wasm: new Uint8Array(await readFile(wasmUrl)),
      adapter: new URL("./fx-adapter.mjs", import.meta.url),
      timeoutMs: 120_000,
    }),
  ],
});

const result = await bash.exec(
  'echo "Keep it brief." | fx "Read notes.md and summarize the release." > summary.md && cat summary.md',
);
console.log(result.stdout);
```

The adapter passes `ctx.module` to `createFxAgent` from `libfx/wasm`. The SDK
supplies its own WASI and async host imports, while the adapter connects prompt
input, text output, and a `read_file` tool to the shell. Gateway requests use the
SDK's host `fetch`; the shell's network settings do not apply to adapter code.
libfx is an example dependency only.

### WASI commands

The default adapter runs a **WASI Preview 1 command binary**. Its arguments,
exported environment, stdin, stdout, and files connect to the shell:

```typescript
import { readFile } from "node:fs/promises";
import { defineWasmCommand } from "just-bash";

const tool = defineWasmCommand("tool", {
  wasm: new Uint8Array(await readFile("./tool.wasm")),
});
```

Register `tool` in `new Bash({ customCommands: [tool] })`.
`defineWasiCommand` is also available as a shorthand that selects WASI explicitly.
Binaries are supplied by your application; they are not bundled with just-bash.
An asynchronous loader is also supported:
`wasm` may be an async function that receives an `AbortSignal` and returns a
`Uint8Array`. When fetching bytes, check `response.ok` before reading the body,
as in the [browser example](#browser-setup).
The loader runs as trusted host code and is called once per invocation.

### WASM library adapters

An adapter is a trusted JavaScript module whose default-exported function maps
the shell's inputs to a library's exports:

```typescript
import { readFile } from "node:fs/promises";
import { defineWasmCommand } from "just-bash";

const rot13 = defineWasmCommand("rot13", {
  wasm: new Uint8Array(await readFile("./rot13.wasm")),
  adapter: new URL("./rot13-adapter.mjs", import.meta.url),
});
```

Register `rot13` in `new Bash({ customCommands: [rot13] })`. The
[library example](https://github.com/vercel-labs/just-bash/tree/main/examples/wasm-library)
provides both files.

For example, an adapter for a library exporting an `add` function could be:

```typescript
import type { WasmAdapter } from "just-bash";

const adapter: WasmAdapter = async (ctx) => {
  const numbers = ctx.args.map(Number);
  if (numbers.length !== 2 || numbers.some((n) => !Number.isFinite(n))) {
    ctx.stderr.write("Usage: add NUMBER NUMBER\n");
    return 2;
  }
  const { exports } = await ctx.instantiate();
  if (typeof exports.add !== "function") throw new Error("Missing add export");
  ctx.stdout.write(`${exports.add(...numbers)}\n`);
};
export default adapter;
```

Compile the adapter to JavaScript and register its absolute module URL. Node
loads local `file:` modules; browsers load served HTTP(S) modules. The adapter
executes inside the invocation's worker and can use `ctx.stdin`, `ctx.stdout`,
`ctx.stderr`, synchronous `ctx.fs` operations, and `ctx.env`. Adapter filesystem
paths resolve relative to the shell cwd. Return an exit code or void for success.

`ctx.instantiate(imports)` links explicit imports and enforces the supplied
module's memory/table limits. It can be called once per invocation. Modules
without memory or `_start` are supported, as are bounded imported memories and
function tables. Adapters can also use `ctx.wasi.imports`, `ctx.wasi.start()` and
`ctx.wasi.initialize()` for libraries that need WASI services.

SDKs that instantiate internally can accept `ctx.module`, the compiled module
with the same memory/table bounds. These bounds apply per instance. The trusted
adapter must ensure the SDK creates only one instance; the runner does not
enforce an instantiation count through the SDK. The libfx example uses this API.

The [WASM library example](https://github.com/vercel-labs/just-bash/tree/main/examples/wasm-library)
includes a freestanding C library, custom imports, an adapter, and shell pipelines.
Adapters are trusted application code: their callbacks define what the guest
can access and must validate guest pointers/lengths. Generated SDKs or Emscripten
glue need integration with `ctx.instantiate()` or `ctx.module` and the virtual
I/O APIs. The runner does not automatically infer a library's ABI, and module
limits do not bound arbitrary JavaScript allocations or external operations
in an adapter.

### WASI compatibility

The default WASI adapter supports the following:

- Accepts wasm32 core modules importing `wasi_snapshot_preview1` and exporting
  `memory` and `_start`. Other imports and Emscripten glue require a custom
  adapter. WASI Preview 2 components, shared memories, and threads are unsupported
  by the runner.
- Supports file reads/writes, seeking, truncation, directory listing, stat,
  rename, deletion, and links through the configured `IFileSystem`. Binary data
  is preserved through pipes and redirections. Guest exit codes are returned.
- **Guest paths start at `/`.** WASI Preview 1 has no portable initial cwd.
  `PWD` contains the shell's working directory: use `tool "$PWD/notes.md"`
  after `cd`, or use absolute virtual paths. The whole virtual root is preopened.
- Sockets, subprocesses, polling/sleep, file allocation, and setting timestamps
  are unsupported. Unsupported calls return a WASI error or fail the command.
  Programs that need these facilities require adaptation.
- Descriptors use virtual paths. Removing an open file/directory or replacing
  an open destination returns `EBUSY`; rename updates open source descriptors.
  Concurrent namespace mutation by another filesystem user is unsupported.
- The module is compiled for each invocation. Large binaries have a noticeable
  startup cost.

### Limits

| Option | Default | Scope |
| --- | --- | --- |
| `timeoutMs` | 30,000 | Loading, compilation, and execution |
| `maxMemoryBytes` | 256 MiB | Linear memory per instance; rounded down to 64 KiB pages |
| `maxModuleBytes` | 64 MiB | Supplied binary size |
| `maxFileBytes` | 64 MiB | Individual file read/write size |
| `maxTableElements` | 1,000,000 | Function table size per instance |

Shell execution limits also apply, including output, file descriptors, work,
worker messages, and live bytes. Memory and table maxima are enforced before
instantiation. The resolved memory limit can be lower than `maxMemoryBytes`
when the shell's remaining live byte budget is smaller. A timeout or cancellation
terminates the worker (exit 124); module/runner failures return exit 126. A custom
host loader must cooperate with its abort signal to stop its own external work.

### Browser setup

Import from `just-bash/browser`. Browser execution requires a Web Worker and
`SharedArrayBuffer`; serve the page with these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For bundlers such as Vite, pass the exported worker asset URL explicitly:

```typescript
import { Bash, defineWasmCommand } from "just-bash/browser";
import workerUrl from "just-bash/wasm-worker?url";

const bash = new Bash({
  cwd: "/",
  customCommands: [
    defineWasmCommand("tool", {
      workerUrl,
      timeoutMs: 60_000,
      wasm: async (signal) => {
        const response = await fetch("/tool.wasm", { signal });
        if (!response.ok) throw new Error("Could not load WASM command");
        return new Uint8Array(await response.arrayBuffer());
      },
    }),
  ],
});
```

You can also copy `just-bash/wasm-worker` to a public asset directory and supply
its URL (`just-bash/wasi-worker` is an alias). For custom adapters, serve the
adapter and its dependencies as a separate JavaScript module. Hosts without
cross-origin isolation cannot run these WebAssembly commands.

<details>
<summary><h2>Supported Commands</h2></summary>

### File Operations

`cat`, `cp`, `file`, `ln`, `ls`, `mkdir`, `mv`, `readlink`, `rm`, `rmdir`, `split`, `stat`, `touch`, `tree`

### Text Processing

`awk`, `base64`, `column`, `comm`, `cut`, `diff`, `expand`, `fold`, `grep` (+ `egrep`, `fgrep`), `head`, `join`, `md5sum`, `nl`, `od`, `paste`, `printf`, `rev`, `rg`, `sed`, `sha1sum`, `sha256sum`, `sort`, `strings`, `tac`, `tail`, `tr`, `unexpand`, `uniq`, `wc`, `xargs`

### Data Processing

`jq` (JSON), `sqlite3` (SQLite), `xan` (CSV), `yq` (YAML/XML/TOML/CSV)

### Optional Runtimes

`js-exec` (JavaScript/TypeScript via QuickJS; requires `javascript: true`), `python3`/`python` (Python via CPython; requires `python: true`)

### Compression & Archives

`gzip` (+ `gunzip`, `zcat`), `tar`

### Navigation & Environment

`basename`, `cd`, `dirname`, `du`, `echo`, `env`, `export`, `find`, `hostname`, `printenv`, `pwd`, `tee`

### Shell Utilities

`alias`, `bash`, `chmod`, `clear`, `date`, `expr`, `false`, `help`, `history`, `seq`, `sh`, `sleep`, `time`, `timeout`, `true`, `unalias`, `which`, `whoami`

### Network

`curl`, `html-to-markdown` (require [network configuration](#network-access))

All commands support `--help` for usage information.

### Shell Features

- **Pipes**: `cmd1 | cmd2`
- **Redirections**: `>`, `>>`, `2>`, `2>&1`, `<`
- **Command chaining**: `&&`, `||`, `;`
- **Variables**: `$VAR`, `${VAR}`, `${VAR:-default}`
- **Positional parameters**: `$1`, `$2`, `$@`, `$#`
- **Glob patterns**: `*`, `?`, `[...]`
- **If statements**: `if COND; then CMD; elif COND; then CMD; else CMD; fi`
- **Functions**: `function name { ... }` or `name() { ... }`
- **Local variables**: `local VAR=value`
- **Loops**: `for`, `while`, `until`
- **Symbolic links**: `ln -s target link`
- **Hard links**: `ln target link`

</details>

## Configuration

```typescript
const env = new Bash({
  files: { "/data/file.txt": "content" }, // Initial files
  env: { MY_VAR: "value" }, // Initial environment
  cwd: "/app", // Starting directory (default: /home/user)
  executionLimits: { maxCallDepth: 50 }, // See "Execution Protection"
  python: true, // Enable python3/python commands
  javascript: true, // Enable js-exec command
  // Or with bootstrap: javascript: { bootstrap: "globalThis.X = 1;" }
});

// Per-exec overrides
await env.exec("echo $TEMP", { env: { TEMP: "value" }, cwd: "/tmp" });

// Pass stdin to the script
await env.exec("cat", { stdin: "hello from stdin\n" });

// Start with a clean environment
await env.exec("env", { replaceEnv: true, env: { ONLY: "this" } });

// Pass arguments without shell escaping (like spawnSync)
await env.exec("grep", { args: ["-r", "TODO", "src/"] });

// Cancel long-running scripts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await env.exec("while true; do sleep 1; done", { signal: controller.signal });

// Preserve leading whitespace (e.g., for heredocs)
await env.exec("cat <<EOF\n  indented\nEOF", { rawScript: true });
```

### Timezone

`date` defaults to UTC (`%Z=UTC`, `%z=+0000`) regardless of the host clock, so the sandbox does not leak the host timezone. To opt into a specific zone, pass `TZ` as an initial env var:

```typescript
const bash = new Bash({ env: { TZ: "America/New_York" } });
await bash.exec("date"); // Mon Jun  1 09:30:00 EDT 2026
```

`-u` always forces UTC; an unset or invalid `$TZ` falls back to UTC. Setting `TZ` exposes that timezone to scripts running in the sandbox, so only pass a value you are comfortable revealing — forwarding the host's real `$TZ` (e.g. `process.env.TZ`) reintroduces the disclosure that the UTC default exists to prevent.

`exec()` options:

| Option | Type | Description |
|---|---|---|
| `env` | `Record<string, string>` | Environment variables for this execution only |
| `cwd` | `string` | Working directory for this execution only |
| `stdin` | `string` | Standard input passed to the script |
| `args` | `string[]` | Additional argv passed directly to the first command (bypasses shell parsing; does not change `$1`, `$2`, ...) |
| `replaceEnv` | `boolean` | Start with empty env instead of merging (default: `false`) |
| `signal` | `AbortSignal` | Cooperative cancellation; stops at next statement boundary |
| `rawScript` | `boolean` | Skip leading-whitespace normalization (default: `false`) |

## Filesystem Options

Four filesystem implementations:

**InMemoryFs** (default) - Pure in-memory filesystem, no disk access:

```typescript
import { Bash } from "just-bash";

const env = new Bash({
  files: {
    "/data/config.json": '{"key": "value"}',
    // Lazy: called on first read, cached. Never called if written before read.
    "/data/large.csv": () => "col1,col2\na,b\n",
    "/data/remote.txt": async () => (await fetch("https://example.com")).text(),
  },
});
```

**OverlayFs** - Copy-on-write over a real directory. Reads come from disk, writes stay in memory:

```typescript
import { Bash } from "just-bash";
import { OverlayFs } from "just-bash/fs/overlay-fs";

const overlay = new OverlayFs({
  root: "/path/to/project",
  // Copy-on-write data is bounded independently from real-file reads.
  maxMemoryBytes: 256 * 1024 * 1024,
});
const env = new Bash({ fs: overlay, cwd: overlay.getMountPoint() });

await env.exec("cat package.json"); // reads from disk
await env.exec('echo "modified" > package.json'); // stays in memory
```

`maxMemoryBytes` defaults to 1 GiB and covers aggregate files retained in the
copy-on-write layer, including append chunks. Set it to the deployment's memory
budget when an `OverlayFs` is reused across executions.

**ReadWriteFs** - Direct read-write access to a real directory. Use this if you want the agent to be able to write to your disk:

```typescript
import { Bash } from "just-bash";
import { ReadWriteFs } from "just-bash/fs/read-write-fs";

const rwfs = new ReadWriteFs({ root: "/path/to/sandbox" });
const env = new Bash({ fs: rwfs });

await env.exec('echo "hello" > file.txt'); // writes to real filesystem
```

Keep `ReadWriteFs` pointed at a workspace directory, not at the installed `just-bash` package or any other trusted runtime code. Guest-writable roots should stay separate from trusted code.

`ReadWriteFs` uses normal in-place filesystem operations for private regular
files. For multiply-linked regular files, it isolates append and metadata
changes by copying the file and replacing only the sandbox directory entry, so
a host-created hard link cannot carry those changes beyond the configured root.
Implicit copies are limited by `maxCopyOnWriteSize` (100 MB by default; set it
to `0` to disable the limit). Overwrite does not need to copy existing content.
Explicit `cp` copies can be limited with the opt-in `maxCopySize` option
(unlimited by default). The portable copy path may materialize sparse-file
holes, so embeddings that require a disk-allocation bound should configure
`maxCopySize`.

Shared-inode isolation has a few deliberate limitations:

- Append, `chmod`, and `utimes` on a multiply-linked regular file require read
  access to the file and write access to its parent directory. They fail with
  `EFBIG` when the file exceeds `maxCopyOnWriteSize`.
- Copies use `O_NOATIME` when the Node.js runtime exposes it and retry with
  normal read semantics if the kernel returns `EPERM`. Runtimes and platforms
  without `O_NOATIME` may update access-time metadata visible through another
  hard link.
- Do not mutate a `ReadWriteFs` root concurrently through direct host filesystem
  APIs. Node.js does not expose the descriptor-relative operations needed to
  make pathname validation atomic against an external actor. A concurrent host
  append to a multiply-linked file may be lost when the isolated entry is
  replaced.
- Mutations in overlapping `ReadWriteFs` roots are serialized within the
  process. Unrelated roots proceed independently. The queue is not cancellable
  or bounded, so a large mutation can delay later operations in overlapping
  roots even if the requesting script is subsequently aborted.
- Content writes and appends to FIFOs, sockets, devices, and other special files
  are rejected. This avoids indefinitely occupying an overlapping-root mutation
  slot on a blocking special-file open. Metadata operations remain supported
  for single-link special files; multiply-linked special files are rejected
  because they cannot be isolated without changing their file type.
- Private-file and single-link special-file metadata operations use pathname
  APIs to preserve normal host permission semantics. They are not atomic
  against a trusted host actor concurrently replacing that pathname with a
  symlink. With `allowSymlinks: false`, symlinks present during normal path
  validation are still rejected.
- Copying a symlink preserves whether its guest target is absolute or relative.
  Only symlinks whose resolved targets remain inside the root are copied.
- Regular-file copies replace the destination entry to prevent writes through
  hard links. Existing destinations must still be writable, and their parent
  directory must be writable so the isolated entry can be committed. Thus a
  writable destination in a non-writable directory cannot be copied over.
  Copying over a FIFO, socket, device, or other special entry is rejected.

**MountableFs** - Mount multiple filesystems at different paths. Combines read-only and read-write filesystems into a unified namespace:

```typescript
import { Bash, MountableFs, InMemoryFs } from "just-bash";
import { OverlayFs } from "just-bash/fs/overlay-fs";
import { ReadWriteFs } from "just-bash/fs/read-write-fs";

const fs = new MountableFs({ base: new InMemoryFs() });

// Mount read-only knowledge base
fs.mount("/mnt/knowledge", new OverlayFs({ root: "/path/to/knowledge", readOnly: true }));

// Mount read-write workspace
fs.mount("/home/agent", new ReadWriteFs({ root: "/path/to/workspace" }));

const bash = new Bash({ fs, cwd: "/home/agent" });

await bash.exec("ls /mnt/knowledge"); // reads from knowledge base
await bash.exec("cp /mnt/knowledge/doc.txt ./"); // cross-mount copy
await bash.exec('echo "notes" > notes.txt'); // writes to workspace
```

You can also configure mounts in the constructor:

```typescript
import { MountableFs, InMemoryFs } from "just-bash";
import { OverlayFs } from "just-bash/fs/overlay-fs";
import { ReadWriteFs } from "just-bash/fs/read-write-fs";

const fs = new MountableFs({
  base: new InMemoryFs(),
  mounts: [
    { mountPoint: "/data", filesystem: new OverlayFs({ root: "/shared/data" }) },
    { mountPoint: "/workspace", filesystem: new ReadWriteFs({ root: "/tmp/work" }) },
  ],
});
```

## Optional Capabilities

### Network Access

Network access is disabled by default. Enable it with the `network` option:

```typescript
// Allow specific URLs with GET/HEAD only (safest)
const env = new Bash({
  network: {
    allowedUrlPrefixes: [
      "https://api.github.com/repos/myorg/",
      "https://api.example.com",
    ],
  },
});

// Allow specific URLs with additional methods
const env = new Bash({
  network: {
    allowedUrlPrefixes: ["https://api.example.com"],
    allowedMethods: ["GET", "HEAD", "POST"], // Default: ["GET", "HEAD"]
  },
});

// Inject credentials via header transforms (secrets never enter the sandbox)
const env = new Bash({
  network: {
    allowedUrlPrefixes: [
      "https://public-api.com", // plain string — no transforms
      {
        url: "https://ai-gateway.vercel.sh",
        transform: [{ headers: { Authorization: "Bearer secret" } }],
      },
    ],
  },
});

// Allow all URLs and methods (use with caution)
const env = new Bash({
  network: { dangerouslyAllowFullInternetAccess: true },
});
```

**Note:** The `curl` command only exists when network is configured. Without network configuration, `curl` returns "command not found".

#### Allow-List Security

The allow-list enforces:

- **Origin matching**: URLs must match the exact origin (scheme + host + port)
- **Path prefix**: Only paths starting with the specified prefix are allowed
- **HTTP method restrictions**: Only GET and HEAD by default (configure `allowedMethods` for more)
- **Redirect protection**: Redirects to non-allowed URLs are blocked
- **Header transforms**: Firewall headers are injected at the fetch boundary and override any user-supplied headers with the same name, preventing credential substitution from inside the sandbox. Headers are re-evaluated on each redirect so credentials are never leaked to non-transform hosts

#### Using curl

```bash
# Fetch and process data
curl -s https://api.example.com/data | grep pattern

# Download and convert HTML to Markdown
curl -s https://example.com | html-to-markdown

# POST JSON data
curl -X POST -H "Content-Type: application/json" \
  -d '{"key":"value"}' https://api.example.com/endpoint
```

### JavaScript Support

JavaScript and TypeScript execution via QuickJS is opt-in due to additional security surface. Enable with `javascript: true`:

```typescript
const env = new Bash({
  javascript: true,
});

// Execute JavaScript code
await env.exec('js-exec -c "console.log(1 + 2)"');

// Run script files (.js, .mjs, .ts, .mts)
await env.exec('js-exec script.js');

// ES module mode with imports
await env.exec('js-exec -m -c "import fs from \'fs\'; console.log(fs.readFileSync(\'/data/file.txt\', \'utf8\'))"');
```

#### Bootstrap Code

Run setup code before every `js-exec` invocation with the `bootstrap` option:

```typescript
const env = new Bash({
  javascript: {
    bootstrap: `
      globalThis.API_BASE = "https://api.example.com";
      globalThis.formatDate = (d) => new Date(d).toISOString();
    `,
  },
});

await env.exec('js-exec -c "console.log(API_BASE)"');
// Output: https://api.example.com
```

#### Node.js Compatibility

`js-exec` supports `require()` and `import` with these Node.js modules:

- **fs**: `readFileSync`, `writeFileSync`, `readdirSync`, `statSync`, `existsSync`, `mkdirSync`, `rmSync`, `fs.promises.*`
- **path**: `join`, `resolve`, `dirname`, `basename`, `extname`, `relative`, `normalize`
- **child_process**: `execSync`, `spawnSync`
- **process**: `argv`, `cwd()`, `exit()`, `env`, `platform`, `version`
- **Other modules**: `os`, `url`, `assert`, `util`, `events`, `buffer`, `stream`, `string_decoder`, `querystring`
- **Globals**: `console`, `fetch`, `Buffer`, `URL`, `URLSearchParams`

`fs.readFileSync()` returns a `Buffer` by default (matching Node.js). Pass an encoding like `'utf8'` to get a string.

**Note:** The `js-exec` command only exists when `javascript` is configured. It is not available in browser environments. Execution uses the `run` package's QuickJS sandbox with a 64 MB memory limit and configurable timeout (30 seconds in the default `normal` profile and 10 seconds in the opt-in `hardened` profile). Enabling network access does not extend the configured deadline.

#### Tool Invocation Hook

`js-exec` scripts can call host-defined tools through a global `tools` proxy
when `javascript.invokeTool` is provided:

```typescript
const bash = new Bash({
  javascript: {
    // path:     "math.add"  (dot-separated)
    // argsJson: '{"a":1,"b":2}'  (or "" for no args)
    // return:   JSON-stringified result, or "" for undefined
    // throw:    propagates as a sandbox exception
    invokeTool: async (path, argsJson, abortSignal) => {
      const args = argsJson ? JSON.parse(argsJson) : undefined;
      if (path === "math.add") {
        abortSignal.throwIfAborted();
        return JSON.stringify({ sum: args.a + args.b });
      }
      throw new Error(`Unknown tool: ${path}`);
    },
  },
});

await bash.exec(`js-exec -c 'console.log((await tools.math.add({a:3,b:4})).sum)'`);
```

The `abortSignal` fires when the JavaScript execution is canceled or times
out. Tool implementations should forward it to network requests and other
cancelable work so effects do not outlive the sandbox execution.

The hook is generic — wire any tool framework through it (raw maps, MCP,
Anthropic tool-use, etc.). For full GraphQL / OpenAPI / MCP discovery via
`@executor-js/sdk`, plus auto-generated bash namespace commands, use the
companion package
[**`@just-bash/executor`**](../just-bash-executor/README.md).

### Python Support

Python (CPython compiled to WASM) is opt-in due to additional security surface. Enable with `python: true`:

```typescript
const env = new Bash({
  python: true,
});

// Execute Python code
await env.exec('python3 -c "print(1 + 2)"');

// Run Python scripts
await env.exec('python3 script.py');
```

**Note:** The `python3` and `python` commands only exist when `python: true` is configured. Python is not available in browser environments.

### SQLite Support

`sqlite3` uses sql.js (SQLite compiled to WASM), sandboxed from the real filesystem:

```typescript
const env = new Bash();

// Query in-memory database
await env.exec('sqlite3 :memory: "SELECT 1 + 1"');

// Query file-based database
await env.exec('sqlite3 data.db "SELECT * FROM users"');
```

**Note:** SQLite is not available in browser environments. Queries run in a worker thread with a configurable timeout (30 seconds in the default `normal` profile and 5 seconds in the opt-in `hardened` profile) to prevent runaway queries from blocking execution.

## AST Transform Plugins

Parse bash scripts into an AST, transform them, and serialize back to bash. Good for instrumenting scripts (e.g., capturing per-command stdout/stderr) or extracting metadata before execution.

```typescript
import { Bash, BashTransformPipeline, TeePlugin, CommandCollectorPlugin } from "just-bash";

// Standalone pipeline — output can be run by any shell
const pipeline = new BashTransformPipeline()
  .use(new TeePlugin({ outputDir: "/tmp/logs" }))
  .use(new CommandCollectorPlugin());
const result = pipeline.transform("echo hello | grep hello");
result.script;             // transformed bash string
result.metadata.commands;  // ["echo", "grep", "tee"]

// Integrated API — exec() auto-applies transforms and returns metadata
const bash = new Bash();
bash.registerTransformPlugin(new CommandCollectorPlugin());
const execResult = await bash.exec("echo hello | grep hello");
execResult.metadata?.commands; // ["echo", "grep"]
```

See [src/transform/README.md](src/transform/README.md) for the full API, built-in plugins, and how to write custom plugins.

## Integrations

### AI SDK Tool

[`bash-tool`](https://github.com/vercel-labs/bash-tool) wraps just-bash as an [AI SDK](https://ai-sdk.dev/) tool:

```bash
npm install bash-tool
```

```typescript
import { createBashTool } from "bash-tool";
import { generateText } from "ai";

const bashTool = createBashTool({
  files: { "/data/users.json": '[{"name": "Alice"}, {"name": "Bob"}]' },
});

const result = await generateText({
  model: "anthropic/claude-sonnet-4",
  tools: { bash: bashTool },
  prompt: "Count the users in /data/users.json",
});
```

See [bash-tool](https://github.com/vercel-labs/bash-tool) for more.

### Vercel Sandbox Compatible API

`Sandbox` is a drop-in replacement for [`@vercel/sandbox`](https://vercel.com/docs/vercel-sandbox) — same API, but runs entirely in-process with the virtual filesystem. Start with just-bash for development and testing, swap in a real sandbox when you need a full VM.

```typescript
import { Sandbox } from "just-bash";

// Create a sandbox instance
const sandbox = await Sandbox.create({ cwd: "/app" });

// Write files to the virtual filesystem
await sandbox.writeFiles({
  "/app/script.sh": 'echo "Hello World"',
  "/app/data.json": '{"key": "value"}',
});

// Run commands and get results
const cmd = await sandbox.runCommand("bash /app/script.sh");
const output = await cmd.stdout(); // "Hello World\n"
const exitCode = (await cmd.wait()).exitCode; // 0

// Read files back
const content = await sandbox.readFile("/app/data.json");

// Create directories
await sandbox.mkDir("/app/logs", { recursive: true });

// Clean up (no-op for Bash, but API-compatible)
await sandbox.stop();
```

## CLI

### CLI Binary

Install globally (`npm install -g just-bash`) for a sandboxed CLI:

```bash
# Execute inline script
just-bash -c 'ls -la && cat package.json | head -5'

# Execute with specific project root
just-bash -c 'grep -r "TODO" src/' --root /path/to/project

# Pipe script from stdin
echo 'find . -name "*.ts" | wc -l' | just-bash

# Execute a script file
just-bash ./scripts/deploy.sh

# Get JSON output for programmatic use
just-bash -c 'echo hello' --json
# Output: {"stdout":"hello\n","stderr":"","exitCode":0}
```

The CLI uses OverlayFS — reads come from the real filesystem, but all writes stay in memory and are discarded after execution.

**Important**: The project root is mounted at `/home/user/project`. Use this path (or relative paths from the default cwd) to access your files inside the sandbox.

Options:

- `-c <script>` - Execute script from argument
- `--root <path>` - Root directory (default: current directory)
- `--cwd <path>` - Working directory in sandbox
- `-e, --errexit` - Exit on first error
- `--json` - Output as JSON

### Interactive Shell

```bash
pnpm shell
```

The interactive shell has full internet access by default. Disable with `--no-network`:

```bash
pnpm shell --no-network
```

## Execution Protection

Bash protects against infinite loops and deep recursion with configurable limits:

```typescript
const env = new Bash({
  // `normal` is the liberal, compatibility-oriented default. Use `hardened`
  // for tighter untrusted-workload policy, then override individual resources.
  executionLimitProfile: "hardened",
  executionLimits: {
    maxCallDepth: 100, // Max function recursion depth
    maxCommandCount: 20000, // Shared across nested execution
    maxSourceBytes: 8 * 1024 * 1024, // Shell source before parsing
    maxFileSystemBytes: 256 * 1024 * 1024, // Retained default-FS data
    maxOutputSize: 32 * 1024 * 1024, // Aggregate stdout + stderr bytes
    maxArchiveBytes: 256 * 1024 * 1024, // Expanded archive bytes
    maxDatabaseBytes: 128 * 1024 * 1024, // SQLite image bytes
    maxExecutionTimeMs: 30_000, // Whole execution wall-clock deadline
    maxExtensionCleanupTimeMs: 25, // Cancellation acknowledgement grace
  },
});
```

All resources remain bounded by default in both profiles. Explicit values
override the selected profile; non-negative safe integers and the legacy
`Infinity` spelling are accepted. Infinite deadlines omit the corresponding
platform timer rather than overflowing it; `js-exec` maps an infinite
JavaScript deadline to `run`'s longest timeout (about 24.9 days). Invalid
values are rejected when `Bash` is constructed. Error messages identify the
resource that was hit.

## Security Model

The Node.js package requires Node `>=20.19`.

- The shell only has access to the provided filesystem.
- All execution happens without VM isolation. This does introduce additional risk. The code base was designed to be robust against prototype-pollution attacks and other break outs to the host JS engine and filesystem.
- There is no network access by default. When enabled, requests are checked against URL prefix allow-lists and HTTP-method allow-lists.
- Python and JavaScript execution are off by default as they represent additional security surface.
- WASI commands are registered explicitly by the host. Guest code runs inside
  WebAssembly with only WASI imports and the shell's virtual filesystem. It has
  no direct host filesystem, network, process, or JavaScript access. A configured
  `ReadWriteFs` still grants its usual writes to disk. The built-in WASI runtime and host
  bridge are trusted code; workers provide termination, while WebAssembly and
  the restricted imports provide guest isolation. Linear memory limits do not
  constitute a total process memory limit.
- Custom WebAssembly adapters are trusted JavaScript modules running inside the
  worker. They define the guest's imports and can use the worker's host APIs.
  Only register adapters you control; the guest cannot select its own adapter.
- `js-exec` guest code runs inside the `run` package's QuickJS/WASM realm. Its
  primary isolation boundary is QuickJS plus the validated, bounded host
  bridge; guest JavaScript does not execute in the Node worker realm.
- Execution is protected against infinite loops and deep recursion with configurable limits.
- Host-realm defense-in-depth uses the strongest scoped controls available on
  each supported Node runtime. Where `node:module.registerHooks()` is present,
  builtin ESM imports can also be denied only for the untrusted async context;
  older runtimes retain best-effort scoped protection without failing existing
  applications. It never installs a process-global deny-all loader. Query the
  resolved capabilities with `DefenseInDepthBox.getInstance().getStatus()`.
  Audit mode reports `level: "none"` because it records violations without
  enforcing them.
- Scoped defense uses reversible proxies for `Reflect`, `JSON`, and `Math` and
  restores their host descriptors on deactivation. This is reported as
  `intrinsicProtection: "scoped-best-effort"`: same-realm JavaScript that
  cached an intrinsic or a mutation function before activation cannot be fully
  revoked (including the direct `delete` operator). The separately named
  `processLifetimeIntrinsicHardening: true` option permanently freezes those
  objects and locks selected well-known Symbol descriptors; use it only in a
  disposable or process-lifetime realm. Use an isolated worker/process when
  complete protection and reversible host state are both required.
- Node worker `resourceLimits` do not reliably cap the WebAssembly linear memory used by CPython or sql.js. Queue, deadline, file, database, bridge, and payload limits reduce exposure, but strong memory containment for these opt-in runtimes requires process/container isolation or a WASM build with a lower hard maximum.
- Use [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) if you need a full VM with arbitrary binary execution.

## Browser Support

The core shell (parsing, execution, filesystem, and all built-in commands) works in browser environments. The following features require Node.js and are unavailable in browsers: `python3`/`python`, `sqlite3`, `js-exec`, and `OverlayFs`/`ReadWriteFs` (which access the real filesystem).

Opt-in [WebAssembly commands](#webassembly-commands) also support browsers with workers and
cross-origin isolation.

## Default Layout

When created without options, Bash provides a Unix-like directory structure:

- `/home/user` - Default working directory (and `$HOME`)
- `/bin` - Contains stubs for all built-in commands
- `/usr/bin` - Additional binary directory
- `/tmp` - Temporary files directory

Commands can be invoked by path (e.g., `/bin/ls`) or by name.

## AI Agent Instructions

For AI agents, [`bash-tool`](https://github.com/vercel-labs/bash-tool) provides additional guidance in its `AGENTS.md`:

```bash
cat node_modules/bash-tool/dist/AGENTS.md
```

## License

Apache-2.0
