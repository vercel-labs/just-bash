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
import { Bash, defineCommand } from "just-bash";

const hello = defineCommand("hello", async (args, ctx) => {
  const name = args[0] || "world";
  return { stdout: `Hello, ${name}!\n`, stderr: "", exitCode: 0 };
});

const upper = defineCommand("upper", async (args, ctx) => {
  return { stdout: ctx.stdin.toUpperCase(), stderr: "", exitCode: 0 };
});

const bash = new Bash({ customCommands: [hello, upper] });

await bash.exec("hello Alice"); // "Hello, Alice!\n"
await bash.exec("echo 'test' | upper"); // "TEST\n"
```

Custom commands receive a `CommandContext` with `fs`, `cwd`, `env`, `stdin`, and `exec` (for subcommands), and work with pipes, redirections, and all shell features.

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

const overlay = new OverlayFs({ root: "/path/to/project" });
const env = new Bash({ fs: overlay, cwd: overlay.getMountPoint() });

await env.exec("cat package.json"); // reads from disk
await env.exec('echo "modified" > package.json'); // stays in memory
```

**ReadWriteFs** - Direct read-write access to a real directory. Use this if you want the agent to be able to write to your disk:

```typescript
import { Bash } from "just-bash";
import { ReadWriteFs } from "just-bash/fs/read-write-fs";

const rwfs = new ReadWriteFs({ root: "/path/to/sandbox" });
const env = new Bash({ fs: rwfs });

await env.exec('echo "hello" > file.txt'); // writes to real filesystem
```

Keep `ReadWriteFs` pointed at a workspace directory, not at the installed `just-bash` package or any other trusted runtime code. Guest-writable roots should stay separate from trusted code.

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

**Note:** The `js-exec` command only exists when `javascript` is configured. It is not available in browser environments. Execution runs in a QuickJS WASM sandbox with a 64 MB memory limit and configurable timeout (default: 10s, 60s with network).

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

**Note:** SQLite is not available in browser environments. Queries run in a worker thread with a configurable timeout (default: 5 seconds) to prevent runaway queries from blocking execution.

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
  executionLimits: {
    maxCallDepth: 100, // Max function recursion depth
    maxCommandCount: 10000, // Max total commands executed
    maxLoopIterations: 10000, // Max iterations per loop
    maxAwkIterations: 10000, // Max iterations in awk programs
    maxSedIterations: 10000, // Max iterations in sed scripts
  },
});
```

All limits have defaults. Error messages tell you which limit was hit. Increase as needed for your workload.

## Security Model

- The shell only has access to the provided filesystem.
- All execution happens without VM isolation. This does introduce additional risk. The code base was designed to be robust against prototype-pollution attacks and other break outs to the host JS engine and filesystem.
- There is no network access by default. When enabled, requests are checked against URL prefix allow-lists and HTTP-method allow-lists.
- Python and JavaScript execution are off by default as they represent additional security surface.
- Execution is protected against infinite loops and deep recursion with configurable limits.
- Use [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) if you need a full VM with arbitrary binary execution.

## Browser Support

The core shell (parsing, execution, filesystem, and all built-in commands) works in browser environments. The following features require Node.js and are unavailable in browsers: `python3`/`python`, `sqlite3`, `js-exec`, and `OverlayFs`/`ReadWriteFs` (which access the real filesystem).

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
