# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

bash-env is a TypeScript implementation of a bash interpreter with an in-memory virtual filesystem. Designed for AI agents needing a secure, sandboxed bash environment. No WASM dependencies allowed.

## Commands

```bash
# Build & Lint
pnpm build                 # Build TypeScript (required before using dist/)
pnpm typecheck             # Type check
pnpm lint:fix              # Fix lint errors (biome)

# Testing
pnpm test:run              # Run ALL tests (including spec tests)
pnpm test:unit             # Run unit tests only (fast, no comparison/spec)
pnpm test:comparison       # Run comparison tests only

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
```

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

**Filesystem** (`src/fs.ts`, `src/overlay-fs/`): In-memory VFS with optional overlay on real filesystem

### Adding Commands

Commands go in `src/commands/<name>/` with:

1. Implementation file with usage statement
2. Unit tests (collocated `*.test.ts`)
3. Error on unknown options (unless real bash ignores them)
4. Comparison tests in `src/comparison-tests/` for behavior validation

### Testing Strategy

- **Unit tests**: Fast, isolated tests for specific functionality
- **Comparison tests**: Run same script in bash-env and real bash, compare output
- **Spec tests** (`src/spec-tests/`): Bash specification conformance (may have known failures)

Prefer comparison tests when uncertain about bash behavior. Keep test files under 300 lines.

## Development Guidelines

- Read AGENTS.md
- Use `pnpm dev:exec` instead of ad-hoc test scripts (avoids approval prompts)
- Always verify with `pnpm typecheck && pnpm test:run` before finishing
- Assert full stdout/stderr in tests, not partial matches
- Implementation must match real bash behavior, not convenience
- Dependencies using WASM are not allowed
- We explicitly don't support 64-bit integers
- All parsing/execution must have reasonable limits to prevent runaway compute
