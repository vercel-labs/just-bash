# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

just-bash is a TypeScript implementation of a bash interpreter with an in-memory virtual filesystem. Designed for AI agents needing a secure, sandboxed bash environment. No WASM dependencies allowed.

## Commands

```bash
# Build & Lint
pnpm build                 # Build TypeScript (required before using dist/)
pnpm typecheck             # Type check
pnpm lint:fix              # Fix lint errors (biome)
pnpm knip                  # Check for unused exports/dependencies

# Testing
pnpm test:run              # Run ALL tests (including spec tests)
pnpm test:unit             # Run unit tests only (fast, no comparison/spec)
pnpm test:comparison       # Run comparison tests only (uses fixtures)
pnpm test:comparison:record # Re-record comparison test fixtures
pnpm test:python           # Run Python/CPython Emscripten tests only

# Excluding spec tests (spec tests have known failures)
pnpm test:run --exclude src/spec-tests

# Run specific test file
pnpm test:run src/commands/grep/grep.basic.test.ts

# Run specific spec test file by name pattern
pnpm test:run src/spec-tests/spec.test.ts -t "arith.test.sh"
pnpm test:run src/spec-tests/spec.test.ts -t "array-basic.test.sh"

# Interactive shell
pnpm shell                 # Full network access
pnpm shell --no-network    # No network

# Sandboxed CLI (read-only by default)
node ./dist/cli/just-bash.js -c 'ls -la' --root .
node ./dist/cli/just-bash.js -c 'cat package.json' --root .
node ./dist/cli/just-bash.js -c 'grep -r "TODO" src/' --root .
```

### Sandboxed Shell Execution with `just-bash`

The `just-bash` CLI provides a secure, sandboxed bash environment using OverlayFS:

```bash
# Execute inline script (read-only by default)
node ./dist/cli/just-bash.js -c 'ls -la && cat README.md | head -5' --root .

# Execute with JSON output
node ./dist/cli/just-bash.js -c 'echo hello' --root . --json

# Allow writes (writes stay in memory, don't affect real filesystem)
node ./dist/cli/just-bash.js -c 'echo test > /tmp/file.txt && cat /tmp/file.txt' --root . --allow-write

# Execute script file
node ./dist/cli/just-bash.js script.sh --root .

# Exit on first error
node ./dist/cli/just-bash.js -e -c 'false; echo "not reached"' --root .
```

Options:
- `--root <path>` - Root directory (default: current directory)
- `--cwd <path>` - Working directory in sandbox (default: /home/user/project)
- `--allow-write` - Enable write operations (writes stay in memory)
- `--json` - Output as JSON (stdout, stderr, exitCode)
- `-e, --errexit` - Exit on first error

### Debug with `pnpm dev:exec`

Reads script from stdin, executes it, shows output. Prefer this over ad-hoc test files.

```bash
# Basic execution
echo 'echo hello' | pnpm dev:exec

# Compare with real bash
echo 'x=5; echo $((x + 3))' | pnpm dev:exec --real-bash

# Show parsed AST
echo 'for i in 1 2 3; do echo $i; done' | pnpm dev:exec --print-ast

# Multi-line script
echo 'arr=(a b c)
for x in "${arr[@]}"; do
  echo "item: $x"
done' | pnpm dev:exec --real-bash
```

## Architecture

### Core Pipeline

```
Input Script → Parser (src/parser/) → AST (src/ast/) → Interpreter (src/interpreter/) → ExecResult
```

### Key Modules

**Parser** (`src/parser/`): Recursive descent parser producing AST nodes

- `lexer.ts` - Tokenizer with bash-specific handling (heredocs, quotes, expansions)
- `parser.ts` - Main parser orchestrating specialized sub-parsers
- `expansion-parser.ts` - Parameter expansion, command substitution parsing
- `compound-parser.ts` - if/for/while/case/function parsing

**Interpreter** (`src/interpreter/`): AST execution engine

- `interpreter.ts` - Main execution loop, command dispatch
- `expansion.ts` - Word expansion (parameter, brace, glob, tilde, command substitution)
- `arithmetic.ts` - `$((...))` and `((...))` evaluation
- `conditionals.ts` - `[[ ]]` and `[ ]` test evaluation
- `control-flow.ts` - Loops and conditionals execution
- `builtins/` - Shell builtins (export, local, declare, read, etc.)

**Commands** (`src/commands/`): External command implementations

- Each command in its own directory with implementation + tests
- Registry pattern via `registry.ts`

**Filesystem** (`src/fs/`): In-memory VFS with pluggable backends

- `interface.ts` - `IFileSystem` interface all backends implement
- `in-memory-fs/` - Pure in-memory filesystem (default)
- `overlay-fs/` - Copy-on-write over a real directory (reads from disk, writes to memory)
- `read-write-fs/` - Direct read-write to a real directory
- `http-fs/` - Read-only filesystem backed by HTTP `fetch()`. Manifest-driven (file tree declared up front), lazy-fetches on first read, caches in memory. Zero dependencies.
- `mountable-fs/` - Compose multiple `IFileSystem` backends at different mount points
- `mount.ts` - `mount()` helper for concise filesystem composition
- `real-fs-utils.ts` - Shared security helpers for real-FS-backed implementations
- `OverlayFs` / `ReadWriteFs` - Both default to `allowSymlinks: false` (symlinks blocked)
- Symlink policy is enforced at central gate functions (`resolveAndValidate`, `validateRealPath_`) so new methods get protection automatically
- Pass `allowSymlinks: true` only when symlink support is explicitly needed

**AWK** (`src/commands/awk/`): AWK text processing implementation

- `parser.ts` - Parses AWK programs (BEGIN/END blocks, rules, user-defined functions)
- `executor.ts` - Executes parsed AWK programs line by line
- `expressions.ts` - Expression evaluation (arithmetic, string functions, comparisons)
- Supports: field splitting, pattern matching, printf, gsub/sub/split, user-defined functions
- Limitations: User-defined functions support single return expressions only (no multi-statement bodies or if/else)

**SED** (`src/commands/sed/`): Stream editor implementation

- `parser.ts` - Parses sed commands and addresses
- `executor.ts` - Executes sed commands with pattern/hold space
- Supports: s, d, p, q, n, a, i, c, y, =, addresses, ranges, extended regex (-E/-r)
- Has execution limits to prevent runaway compute

**Python** (`src/commands/python3/`): CPython compiled to WebAssembly via Emscripten

- `python3.ts` - Command entry point, arg parsing, worker lifecycle, timeout with worker termination
- `worker.ts` - Worker thread: loads CPython WASM, HOSTFS/HTTPFS bridges, defense-in-depth
- `sync-fs-backend.ts` / `protocol.ts` - SharedArrayBuffer protocol for sync FS calls from WASM
- `fs-bridge-handler.ts` - Main thread: processes FS requests from worker
- Security: isolation by construction (no JS bridge, no ctypes, no dlopen, no NODEFS)
- Defense-in-depth: `Module._load` blocking at file scope (before WASM loads), `WorkerDefenseInDepth` after
- WASM binary at `vendor/cpython-emscripten/` — `python.cjs` has `__emscripten_system` patched to return -1
- `-m MODULE` names are validated with `/^[a-zA-Z_][a-zA-Z0-9_.]*$/` to prevent code injection
- Worker is terminated on timeout via `workerRef` pattern
- WASM memory capped at 512MB (`-sMAXIMUM_MEMORY=536870912`)
- Tests: `pnpm test:python` (excluded from `pnpm test:unit` by default due to WASM load time)

### Adding Commands

Commands go in `src/commands/<name>/` with:

1. Implementation file with usage statement
2. Unit tests (collocated `*.test.ts`)
3. Error on unknown options (unless real bash ignores them)
4. Comparison tests in `src/comparison-tests/` for behavior validation

### Testing Strategy

- **Unit tests**: Fast, isolated tests for specific functionality
- **Comparison tests**: Compare just-bash output against recorded bash fixtures (see `src/comparison-tests/README.md`)
- **Spec tests** (`src/spec-tests/`): Bash specification conformance (may have known failures)

Prefer comparison tests when uncertain about bash behavior. Keep test files under 300 lines.

### Comparison Tests (Fixture System)

Comparison tests use pre-recorded bash outputs stored in `src/comparison-tests/fixtures/`. This eliminates platform differences (macOS vs Linux). See `src/comparison-tests/README.md` for details.

```bash
# Run comparison tests (uses fixtures, no real bash needed)
pnpm test:comparison

# Re-record fixtures (skips locked fixtures)
RECORD_FIXTURES=1 pnpm test:run src/comparison-tests/mytest.comparison.test.ts

# Force re-record including locked fixtures
RECORD_FIXTURES=force pnpm test:comparison
```

When adding comparison tests:
1. Write the test using `setupFiles()` and `compareOutputs()`
2. Run with `RECORD_FIXTURES=1` to generate fixtures
3. Commit both the test file and the generated fixture JSON
4. If manually adjusting for Linux behavior, add `"locked": true` to the fixture

## Composing Filesystems with `mount()` and `HttpFs`

Use `mount()` to compose multiple `IFileSystem` backends into a unified namespace:

```typescript
import { Bash, mount, HttpFs } from "just-bash";

const fs = mount({
  "/data": new HttpFs("https://cdn.example.com/dataset", [
    "train.csv",
    "test.csv",
  ]),
});
const bash = new Bash({ fs });
await bash.exec("cat /data/train.csv | wc -l");
```

`HttpFs` accepts a file list (array of paths or `Record<string, { size?: number }>`), an optional `fetch` function, and optional `headers`. Files are fetched lazily and cached. All write operations throw `EROFS`. Use `prefetch()` to eagerly load all files in parallel.

When `mount()` doesn't receive a `"/"` entry, it creates an `InMemoryFs` base pre-initialised with `/dev`, `/proc`, `/bin` so the shell works out of the box.

## Filesystem Security: Default-Deny Symlinks

`OverlayFs` and `ReadWriteFs` default to `allowSymlinks: false`. This means:

- `symlink()` throws EPERM
- Any path traversing a real-FS symlink is rejected (ENOENT/EACCES)
- `lstat()` and `readlink()` still work on symlinks (they inspect without following)
- `readdir()` lists symlink entries but operations through them fail

**How it works**: Central gate functions (`resolveAndValidate` in ReadWriteFs, `validateRealPath_` in OverlayFs) compare `realPath.slice(root.length)` vs `canonical.slice(canonicalRoot.length)`. A mismatch means a symlink was traversed — zero extra I/O cost.

**TOCTOU protection**: `readFile`, `writeFile`, and `appendFile` in ReadWriteFs use `O_NOFOLLOW` (when `allowSymlinks: false`) to prevent symlink-swap attacks between validation and I/O. `writeFile`/`appendFile` also re-validate paths after `mkdir()` to catch parent-directory-swap attacks.

**When adding new FS methods**: Route all real-FS access through the existing gates. Never call `fs.promises.stat()`, `fs.realpathSync()`, or similar directly on unvalidated paths. For data I/O (read/write), prefer `fs.promises.open()` with `O_NOFOLLOW` over `fs.promises.readFile()`/`writeFile()` to close TOCTOU gaps. The gate-based design means any method that goes through the gate is automatically protected.

**In tests**: Pass `allowSymlinks: true` to the constructor when testing symlink behavior. The `cross-fs-no-symlinks.test.ts` file tests the default-deny behavior and O_NOFOLLOW TOCTOU protection.

## Redirect Error Handling

All filesystem writes in the redirection system (`src/interpreter/redirections.ts`) go through `redirectWrite()` and `redirectAppend()` helpers. These catch FS exceptions and convert them to bash-style error messages (e.g. `bash: /path: Read-only file system`). This ensures read-only backends like `HttpFs` don't crash the interpreter when scripts attempt writes via redirections.

**When adding new redirect operators**: Use `redirectWrite()` / `redirectAppend()` for all FS writes. Never call `ctx.fs.writeFile()` or `ctx.fs.appendFile()` directly in redirection code.

## Development Guidelines

- Read AGENTS.md
- Use `pnpm dev:exec` instead of ad-hoc test scripts (avoids approval prompts)
- Always verify with `pnpm typecheck && pnpm lint:fix && pnpm knip && pnpm test:run` before finishing
- Assert full stdout/stderr in tests, not partial matches
- Implementation must match real bash behavior, not convenience
- Dependencies using WASM are not allowed (exception: sql.js for SQLite, approved for security sandboxing)
- We explicitly don't support 64-bit integers
- All parsing/execution must have reasonable limits to prevent runaway compute
