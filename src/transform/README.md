# Experimental: BASH AST Transforms

Parse bash scripts into an AST, run transform plugins, and serialize back to bash.

```
Input Script --> parse() --> AST --> plugins --> serialize() --> Output Script
```

## BashTransformPipeline (Standalone)

`BashTransformPipeline` is a standalone typed pipeline builder. It does not depend on `Bash` for execution — it only parses, transforms, and serializes. The output is a plain bash string that can be executed by any shell, `child_process.exec`, Docker container, SSH session, or any other runtime.

Each `.use()` call intersects the plugin's metadata type into the result:

```typescript
import { BashTransformPipeline, TeePlugin, CommandCollectorPlugin } from "just-bash";
import { execSync } from "node:child_process";

const pipeline = new BashTransformPipeline()
  .use(new TeePlugin({ outputDir: "/tmp/logs" }))
  .use(new CommandCollectorPlugin());

// Transform the script — no execution happens here
const result = pipeline.transform("echo hello | grep hello");

result.script;              // transformed bash string, ready to execute anywhere
result.metadata.teeFiles;   // TeeFileInfo[]  ← typed!
result.metadata.commands;    // string[]        ← typed!

// Execute with a real shell
execSync(result.script);

// Or pass to any other runtime
// await ssh.exec(result.script);
// await docker.exec(["bash", "-c", result.script]);
```

### `serialize(ast)`

Standalone function. Converts a `ScriptNode` AST back to a bash string:

```typescript
import { parse, serialize } from "just-bash";

const ast = parse("echo hello | cat");
const script = serialize(ast); // "echo hello | cat"
```

The serializer targets **functional equivalence**, not whitespace-exact round-tripping. The invariant is:

```
parse(serialize(parse(input)))  ===  parse(input)
```

## Bash.registerTransformPlugin (Integrated API)

Register plugins directly on a `Bash` instance. When plugins are registered, `exec()` automatically applies them before execution and returns metadata in the result:

```typescript
import { Bash, CommandCollectorPlugin, TeePlugin } from "just-bash";

const bash = new Bash();
bash.registerTransformPlugin(new TeePlugin({ outputDir: "/tmp/logs" }));
bash.registerTransformPlugin(new CommandCollectorPlugin());

// exec() applies transforms automatically and returns metadata
const result = await bash.exec("echo hello | grep hello");
result.metadata?.commands; // ["echo", "grep", "tee"]

// transform() is also available for transform-only (no execution)
const transformed = bash.transform("echo hello | grep hello");
transformed.script;   // re-serialized bash string
transformed.metadata; // merged metadata from all plugins
```

### `bash.exec(script): Promise<BashExecResult>`

When transform plugins are registered, `exec()` parses the script, runs all plugins on the AST, executes the transformed AST, and returns the result with metadata attached.

| Field      | Type                          | Description                             |
|------------|-------------------------------|-----------------------------------------|
| `stdout`   | `string`                      | Standard output                         |
| `stderr`   | `string`                      | Standard error                          |
| `exitCode` | `number`                      | Exit code                               |
| `env`      | `Record<string, string>`      | Environment after execution             |
| `metadata` | `Record<string, unknown> \| undefined` | Merged metadata from all plugins (only set when plugins are registered) |

### `bash.transform(script): BashTransformResult`

Parses the script, runs all registered plugins in sequence, and serializes the final AST back to a bash string. Returns:

| Field      | Type                       | Description                             |
|------------|----------------------------|-----------------------------------------|
| `script`   | `string`                   | Re-serialized bash script               |
| `ast`      | `ScriptNode`               | Final transformed AST                   |
| `metadata` | `Record<string, unknown>`  | Merged metadata from all plugins        |

## Writing Plugins

A plugin implements the `TransformPlugin<TMetadata>` interface:

```typescript
import type { TransformPlugin, TransformContext, TransformResult } from "just-bash";

interface MyMetadata {
  myKey: string;
}

const myPlugin: TransformPlugin<MyMetadata> = {
  name: "my-plugin",
  transform(context: TransformContext): TransformResult<MyMetadata> {
    // context.ast      - current AST (ScriptNode)
    // context.metadata - accumulated metadata from prior plugins

    return {
      ast: context.ast,               // required: return the (possibly modified) AST
      metadata: { myKey: "value" },   // optional: merged into metadata for next plugin
    };
  },
};
```

Plugins are synchronous. Each plugin receives the AST and metadata output by the previous plugin.

### AST Node Types

Key types for walking/transforming the AST (all exported from `just-bash`):

| Type                | Description                                    |
|---------------------|------------------------------------------------|
| `ScriptNode`        | Root node: list of statements                  |
| `StatementNode`     | Pipelines joined by `&&` / `||` / `;`          |
| `PipelineNode`      | Commands joined by `\|`                        |
| `CommandNode`       | Union: `SimpleCommandNode \| CompoundCommand \| FunctionDefNode` |
| `SimpleCommandNode` | `name args... [redirections]` with assignments  |
| `WordNode`          | A shell word made of `WordPart[]`              |

The full set of AST types is defined in `src/ast/types.ts`.

## Built-in Plugins

### `TeePlugin`

Wraps commands with `tee` for stdout capture and `2>` for stderr capture. Generates per-command output files in a directory.

```typescript
import { TeePlugin } from "just-bash";

// Wrap all commands (including single-command pipelines)
new TeePlugin({ outputDir: "/tmp/logs" });

// Only wrap specific commands
new TeePlugin({
  outputDir: "/tmp/logs",
  targetCommandPattern: /^grep$/,
});

// Use a fixed timestamp (useful for testing)
new TeePlugin({
  outputDir: "/tmp/logs",
  timestamp: new Date("2024-01-15T10:30:45.123Z"),
});
```

**Options:**

| Option                 | Type                              | Description                                    |
|------------------------|-----------------------------------|------------------------------------------------|
| `outputDir`            | `string`                          | Directory for output files                     |
| `targetCommandPattern` | `{ test(input: string): boolean }`| Filter which commands to wrap (default: all)   |
| `timestamp`            | `Date`                            | Fixed timestamp (default: `new Date()`)        |

**Filename format:** `{isoTimestamp}-{3-digit-index}-{commandName}.stdout.txt` / `.stderr.txt`

Colons in ISO timestamps are replaced with `-` for filesystem safety: `2024-01-15T10-30-45.123Z`

**Metadata:** Returns `TeePluginMetadata` with a `teeFiles` array of `TeeFileInfo`:

```typescript
interface TeeFileInfo {
  commandIndex: number;   // Global counter across the entire script
  commandName: string;    // e.g. "echo", "grep", "unknown"
  command: string;        // Full command with arguments, e.g. "grep -r pattern src/"
  stdoutFile: string;     // Full path to stdout capture file
  stderrFile: string;     // Full path to stderr capture file
}
```

**Examples:**

```
echo hello
  --> echo hello 2> /tmp/logs/...-000-echo.stderr.txt | tee /tmp/logs/...-000-echo.stdout.txt

echo hello | grep foo
  --> echo hello 2> /tmp/logs/...-000-echo.stderr.txt | tee /tmp/logs/...-000-echo.stdout.txt | grep foo 2> /tmp/logs/...-001-grep.stderr.txt | tee /tmp/logs/...-001-grep.stdout.txt
```

### `CommandCollectorPlugin`

Walks the entire AST and collects all command names into sorted metadata. Does not modify the AST.

```typescript
import { BashTransformPipeline, CommandCollectorPlugin } from "just-bash";

const pipeline = new BashTransformPipeline()
  .use(new CommandCollectorPlugin());

const result = pipeline.transform(`
  if true; then
    echo $(cat file | wc -l)
  fi
`);

result.metadata.commands; // ["cat", "echo", "true", "wc"]
```

**Metadata:** Returns `CommandCollectorMetadata` with a `commands` array of sorted unique command names.

Walks into: compound command bodies (`if`/`for`/`while`/`case`/subshell/group), function definitions, command substitutions (`$(...)` and `` `...` ``), and process substitutions.

## Serializer Coverage

The serializer handles all AST node types produced by the parser:

- **Commands**: simple commands, all compound commands (`if`/`for`/`while`/`until`/`case`/subshell/group), function definitions, arithmetic commands `((...))`, conditional commands `[[ ]]`
- **Words**: literals, single/double quotes, escapes, parameter expansion (all 15+ operations), command substitution, arithmetic expansion, brace expansion, tilde expansion, globs, process substitution
- **Redirections**: all operators (`<`, `>`, `>>`, `>&`, `<&`, `<>`, `>|`, `&>`, `&>>`, `<<<`), heredocs (`<<`, `<<-`), fd variables
- **Arithmetic**: all expression types (binary, unary, ternary, assignment, grouping, array elements, dynamic expressions)
- **Conditionals**: binary/unary tests, `&&`/`||`/`!`, grouping

## File Layout

```
src/transform/
  types.ts                       -- TransformPlugin, TransformContext, etc. (generic)
  pipeline.ts                    -- BashTransformPipeline typed builder
  serialize.ts                   -- AST -> bash string
  serialize.test.ts              -- round-trip tests
  transform.test.ts              -- plugin + pipeline + integration tests
  plugins/
    tee-plugin.ts                -- Per-command tee/stderr wrapping
    command-collector.ts         -- Command name extraction
```
