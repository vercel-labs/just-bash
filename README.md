# just-bash

A simulated bash environment with an in-memory virtual filesystem, written in TypeScript.

Designed for AI agents that need a secure, sandboxed bash environment.

Supports optional network access via `curl` with secure-by-default URL filtering.

**Note**: This is pre-released alpha software. Use at your own risk and please provide feedback.

## Table of Contents

- [Security model](#security-model)
- [Installation](#installation)
- [Usage](#usage)
  - [Basic API](#basic-api)
  - [Configuration](#configuration)
  - [Custom Commands](#custom-commands)
  - [OverlayFs (Copy-on-Write)](#overlayfs-copy-on-write)
  - [AI SDK Tool](#ai-sdk-tool)
  - [Vercel Sandbox Compatible API](#vercel-sandbox-compatible-api)
  - [CLI Binary](#cli-binary)
  - [Interactive Shell](#interactive-shell)
- [Supported Commands](#supported-commands)
- [Shell Features](#shell-features)
- [Default Layout](#default-layout)
- [Network Access](#network-access)
- [Execution Protection](#execution-protection)
- [Development](#development)

## Security model

- The shell only has access to the provided file system.
- Execution is protected against infinite loops or recursion through. However, Bash is not fully robust against DOS from input. If you need to be robust against this, use process isolation at the OS level.
- Binaries or even WASM are inherently unsupported (Use [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) or a similar product if a full VM is needed).
- There is no network access by default.
- Network access can be enabled, but requests are checked against URL prefix allow-lists and HTTP-method allow-lists. See [network access](#network-access) for details

## Installation

```bash
npm install just-bash
```

## Usage

### Basic API

```typescript
import { Bash } from "just-bash";

const env = new Bash();
await env.exec('echo "Hello" > greeting.txt');
const result = await env.exec("cat greeting.txt");
console.log(result.stdout); // "Hello\n"
console.log(result.exitCode); // 0
console.log(result.env); // Final environment after execution
```

Each `exec()` is isolated—env vars, functions, and cwd don't persist across calls (filesystem does).

### Configuration

```typescript
const env = new Bash({
  files: { "/data/file.txt": "content" }, // Initial files
  env: { MY_VAR: "value" }, // Initial environment
  cwd: "/app", // Starting directory (default: /home/user)
  executionLimits: { maxCallDepth: 50 }, // See "Execution Protection"
});

// Per-exec overrides
await env.exec("echo $TEMP", { env: { TEMP: "value" }, cwd: "/tmp" });
```

### Custom Commands

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

await bash.exec("hello Alice");              // "Hello, Alice!\n"
await bash.exec("echo 'test' | upper");      // "TEST\n"
```

Custom commands receive the full `CommandContext` with access to `fs`, `cwd`, `env`, `stdin`, and `exec` for running subcommands.

### OverlayFs (Copy-on-Write)

Seed the bash environment with files from a real directory. The agent can read but not write to the real filesystem - all changes stay in memory.

```typescript
import { Bash, OverlayFs } from "just-bash";

// Files are mounted at /home/user/project by default
const overlay = new OverlayFs({ root: "/path/to/project" });
const env = new Bash({ fs: overlay, cwd: overlay.getMountPoint() });

// Reads come from the real filesystem
await env.exec("cat package.json"); // reads /path/to/project/package.json

// Writes stay in memory (real files unchanged)
await env.exec('echo "modified" > package.json');

// Custom mount point
const overlay2 = new OverlayFs({ root: "/path/to/project", mountPoint: "/" });
```

### AI SDK Tool

Creates a bash tool for use with the [AI SDK](https://ai-sdk.dev/), because [agents love bash](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools).

```typescript
import { createBashTool } from "just-bash/ai";
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

Bash provides a `Sandbox` class that's API-compatible with [`@vercel/sandbox`](https://vercel.com/docs/vercel-sandbox), making it easy to swap implementations. You can start with Bash and switch to a real sandbox when you need the power of a full VM (e.g. to run node, python, or custom binaries).

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

### CLI Binary

After installing globally (`npm install -g just-bash`), use the `just-bash` command as a secure alternative to `bash` for AI agents:

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

The CLI uses OverlayFS - reads come from the real filesystem, but all writes stay in memory and are discarded after execution. The project root is mounted at `/home/user/project`.

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

`alias`, `bash`, `chmod`, `clear`, `date`, `expr`, `false`, `help`, `history`, `seq`, `sh`, `sleep`, `timeout`, `true`, `unalias`, `which`

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

When created without options, Bash provides a Unix-like directory structure:

- `/home/user` - Default working directory (and `$HOME`)
- `/bin` - Contains stubs for all built-in commands
- `/usr/bin` - Additional binary directory
- `/tmp` - Temporary files directory

Commands can be invoked by path (e.g., `/bin/ls`) or by name.

## Network Access

Network access (and the `curl` command) is disabled by default for security. To enable it, configure the `network` option:

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

// Allow all URLs and methods (use with caution)
const env = new Bash({
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

All limits have sensible defaults. Error messages include hints on which limit to increase. Feel free to increase if your scripts intentionally go beyond them.

## Development

```bash
pnpm test        # Run tests in watch mode
pnpm test:run    # Run tests once
pnpm typecheck   # Type check without emitting
pnpm build       # Build TypeScript
pnpm shell       # Run interactive shell
```

## License

Apache-2.0
