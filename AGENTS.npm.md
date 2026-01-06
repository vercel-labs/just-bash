<!--
This file is distributed as dist/AGENTS.md in the npm package.
It provides instructions for AI agents using just-bash in their projects.
The build process copies this file to dist/AGENTS.md (removing this comment).
TypeScript and bash examples are validated by src/readme.test.ts.
-->

# AGENTS.md - just-bash

Instructions for AI agents using just-bash in projects.

## What is just-bash?

A sandboxed bash interpreter with an in-memory virtual filesystem. Use it when you need to:

- Execute shell commands without real filesystem access
- Run untrusted scripts safely
- Process text with standard Unix tools (grep, sed, awk, jq, etc.)

## For AI Agents

If you're building an AI agent that needs a bash tool, use [`bash-tool`](https://github.com/vercel-labs/bash-tool) which is optimized for just-bash:

```sh
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

See the [bash-tool documentation](https://github.com/vercel-labs/bash-tool) for more details.

## Quick Reference

```typescript
import { Bash } from "just-bash";

const bash = new Bash({
  files: { "/data/input.txt": "content" }, // Initial files
  cwd: "/data", // Working directory
});

const result = await bash.exec("cat input.txt | grep pattern");
// result.stdout  - command output
// result.stderr  - error output
// result.exitCode - 0 = success, non-zero = failure
```

## Key Behaviors

1. **Isolation**: Each `exec()` call is isolated. Environment variables, functions, and cwd changes don't persist between calls. Only filesystem changes persist.

2. **No real filesystem**: By default, commands only see the virtual filesystem. Use `OverlayFs` to read from a real directory (writes stay in memory).

3. **No network by default**: `curl` doesn't exist unless you configure `network` options with URL allowlists.

4. **No binaries/WASM**: Only built-in commands work. You cannot run node, python, or other binaries.

## Available Commands

**Text processing**: `awk`, `cat`, `cut`, `grep`, `head`, `jq`, `sed`, `sort`, `tail`, `tr`, `uniq`, `wc`, `xargs`

**File operations**: `cp`, `find`, `ls`, `mkdir`, `mv`, `rm`, `touch`, `tree`

**Utilities**: `base64`, `date`, `diff`, `echo`, `env`, `printf`, `seq`, `tee`

All commands support `--help` for usage details.

## Common Patterns

### Process JSON with jq

```bash
cat data.json | jq '.items[] | select(.active) | .name'
```

### Find and process files

```bash
find . -name "*.ts" -type f | xargs grep -l "TODO"
```

### Text transformation pipeline

```bash
cat input.txt | grep -v "^#" | sort | uniq -c | sort -rn | head -10
```

### AWK for columnar data

```bash
cat data.csv | awk -F',' '{sum += $3} END {print sum}'
```

## Limitations

- **32-bit integers only**: Arithmetic operations use 32-bit signed integers
- **No job control**: No `&`, `bg`, `fg`, or process suspension
- **No external binaries**: Only built-in commands are available
- **Execution limits**: Loops, recursion, and command counts have configurable limits to prevent runaway execution

## Error Handling

Always check `exitCode`:

```typescript
import { Bash } from "just-bash";

const bash = new Bash({ files: { "/file.txt": "some content" } });
const result = await bash.exec("grep pattern file.txt");
if (result.exitCode !== 0) {
  // Command failed - check result.stderr for details
}
```

Common exit codes:

- `0` - Success
- `1` - General error or no matches (grep)
- `2` - Misuse of command (invalid options)
- `127` - Command not found

## Debugging Tips

1. **Check stderr**: Error messages go to `result.stderr`
2. **Use --help**: All commands support `--help` for usage
3. **Test incrementally**: Build pipelines step by step
4. **Quote variables**: Use `"$var"` to handle spaces in values

## Security Model

- Virtual filesystem is isolated from the real system
- Network access requires explicit URL allowlists
- Execution limits prevent infinite loops
- No shell injection possible (commands are parsed, not eval'd)

## Discovering Types

TypeScript types are available in the `.d.ts` files. Use JSDoc-style exploration to understand the API:

```bash
# Find all type definition files
find node_modules/just-bash/dist -name "*.d.ts" | head -20

# View main exports and their types
cat node_modules/just-bash/dist/index.d.ts

# View Bash class options
grep -A 30 "interface BashOptions" node_modules/just-bash/dist/Bash.d.ts

# Search for specific types
grep -r "interface.*Options" node_modules/just-bash/dist/*.d.ts
```

Key types to explore:
- `BashOptions` - Constructor options for `new Bash()`
- `ExecResult` - Return type of `bash.exec()`
- `InitialFiles` - File specification format
