# bash-env

A simulated bash environment with an in-memory virtual filesystem, written in TypeScript.

Designed for AI agents that need a secure, sandboxed bash environment.

Supports optional network access via `curl` with secure-by-default URL filtering.

## Security model

- The shell only has access to the provided file system.
- Execution is protected against infinite loops or recursion through.
- Binaries or even WASM are inherently unsupported (Use [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) or a similar product if a full VM is needed).
- There is no network access by default.
- Network access can be enabled, but requests are checked against URL prefix allow-lists and HTTP-method allow-lists. See [network access](#network-access) for details

## Installation

```bash
npm install bash-env
```

## Usage

### Basic API

```typescript
import { BashEnv } from "bash-env";

const env = new BashEnv();
await env.exec('echo "Hello" > greeting.txt');
const result = await env.exec("cat greeting.txt");
console.log(result.stdout); // "Hello\n"
console.log(result.exitCode); // 0
console.log(result.env); // Final environment after execution
```

Each `exec()` is isolated—env vars, functions, and cwd don't persist across calls (filesystem does).

### Configuration

```typescript
const env = new BashEnv({
  files: { "/data/file.txt": "content" }, // Initial files
  env: { MY_VAR: "value" }, // Initial environment
  cwd: "/app", // Starting directory (default: /home/user)
  maxCallDepth: 50, // Max recursion (default: 100)
  maxLoopIterations: 5000, // Max iterations (default: 10000)
});

// Per-exec overrides
await env.exec("echo $TEMP", { env: { TEMP: "value" }, cwd: "/tmp" });
```

### OverlayFs (Copy-on-Write)

Seed the bash environment with files from a real directory. The agent can read but not write to the real filesystem - all changes stay in memory.

```typescript
import { BashEnv, OverlayFs } from "bash-env";

// Files are mounted at /home/user/project by default
const overlay = new OverlayFs({ root: "/path/to/project" });
const env = new BashEnv({ fs: overlay, cwd: overlay.getMountPoint() });

// Reads come from the real filesystem
await env.exec("cat package.json"); // reads /path/to/project/package.json

// Writes stay in memory (real files unchanged)
await env.exec('echo "modified" > package.json');

// Custom mount point
const overlay2 = new OverlayFs({ root: "/path/to/project", mountPoint: "/" });
```

### AI SDK Tool

Creates a bash tool for use with the [AI SDK](https://ai-sdk.dev/):

```typescript
import { createBashTool } from "bash-env/ai";
import { generateText } from "ai";

const bashTool = createBashTool({
  files: { "/data/users.json": '[{"name": "Alice"}, {"name": "Bob"}]' },
});

const result = await generateText({
  model: "anthropic/claude-haiku-4.5",
  tools: { bash: bashTool },
  prompt: "Count the users in /data/users.json",
});
```

See [`examples/bash-agent`](./examples/bash-agent) for a full implementation.

### Vercel Sandbox Compatible API

BashEnv provides a `Sandbox` class that's API-compatible with [`@vercel/sandbox`](https://vercel.com/docs/vercel-sandbox), making it easy to swap implementations. You can start with BashEnv and switch to a real sandbox when you need the power of a full VM (e.g. to run node, python, or custom binaries).

```typescript
import { Sandbox } from "bash-env";

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

// Clean up (no-op for BashEnv, but API-compatible)
await sandbox.stop();
```

### Interactive Shell

```bash
pnpm shell
```

The interactive shell has full internet access enabled by default, allowing you to use `curl` to fetch data from any URL. Use `--no-network` to disable this:

```bash
pnpm shell --no-network
```

## Supported Commands

### File Operations

`cat`, `cp`, `ln`, `ls`, `mkdir`, `mv`, `readlink`, `rm`, `stat`, `touch`, `tree`

### Text Processing

`awk`, `base64`, `cut`, `diff`, `grep`, `head`, `jq`, `printf`, `sed`, `sort`, `tail`, `tr`, `uniq`, `wc`, `xargs`

### Navigation & Environment

`basename`, `cd`, `dirname`, `du`, `echo`, `env`, `export`, `find`, `printenv`, `pwd`, `tee`

### Shell Utilities

`alias`, `bash`, `chmod`, `clear`, `date`, `false`, `help`, `history`, `sh`, `sleep`, `true`, `unalias`

### Network Commands

`curl`, `html-to-markdown`

All commands support `--help` for usage information.

## Shell Features

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

## Default Layout

When created without options, BashEnv provides a Unix-like directory structure:

- `/home/user` - Default working directory (and `$HOME`)
- `/bin` - Contains stubs for all built-in commands
- `/usr/bin` - Additional binary directory
- `/tmp` - Temporary files directory

Commands can be invoked by path (e.g., `/bin/ls`) or by name.

## Network Access

Network access (and the `curl` command) is disabled by default for security. To enable it, configure the `network` option:

```typescript
// Allow specific URLs with GET/HEAD only (safest)
const env = new BashEnv({
  network: {
    allowedUrlPrefixes: [
      "https://api.github.com/repos/myorg/",
      "https://api.example.com",
    ],
  },
});

// Allow specific URLs with additional methods
const env = new BashEnv({
  network: {
    allowedUrlPrefixes: ["https://api.example.com"],
    allowedMethods: ["GET", "HEAD", "POST"], // Default: ["GET", "HEAD"]
  },
});

// Allow all URLs and methods (use with caution)
const env = new BashEnv({
  network: { dangerouslyAllowFullInternetAccess: true },
});
```

**Note:** The `curl` command only exists when network is configured. Without network configuration, `curl` returns "command not found".

### Allow-List Security

The allow-list enforces:

- **Origin matching**: URLs must match the exact origin (scheme + host + port)
- **Path prefix**: Only paths starting with the specified prefix are allowed
- **HTTP method restrictions**: Only GET and HEAD by default (configure `allowedMethods` for more)
- **Redirect protection**: Redirects to non-allowed URLs are blocked

### Using curl

```bash
# Fetch and process data
curl -s https://api.example.com/data | grep pattern

# Download and convert HTML to Markdown
curl -s https://example.com | html-to-markdown

# POST JSON data
curl -X POST -H "Content-Type: application/json" \
  -d '{"key":"value"}' https://api.example.com/endpoint
```

## Execution Protection

BashEnv protects against infinite loops and deep recursion with configurable limits (`maxCallDepth`, `maxLoopIterations`). Error messages include hints on how to increase limits.

## Development

```bash
pnpm test        # Run tests in watch mode
pnpm test:run    # Run tests once
pnpm typecheck   # Type check without emitting
pnpm build       # Build TypeScript
pnpm shell       # Run interactive shell
```

## License

ISC
