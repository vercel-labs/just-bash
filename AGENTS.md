# AGENTS.md

This file provides guidance to coding agents working with the code in this repository.

[CONTRIBUTING.md](./CONTRIBUTING.md) is the contribution guide: setup and commands, the constraints the implementation must respect, the debugging and testing workflow, and the security requirements that every change must preserve. It applies to agents as much as to anyone else, so read it before making a change.

Source paths below are relative to `packages/just-bash`, the published package. The repository root has no `src/` or `dist/`.

## Workflow shortcuts

These are the parts of that guide that matter most while working quickly:

- Inspect shell behavior with `pnpm dev:exec` instead of writing a throwaway script (see Debugging).
- While iterating, run `pnpm test:unit` or a single test file rather than the full suite (see Setting up).
- Tests run from source. Run `pnpm build` before exercising the compiled output under `dist/`.

## Writing

Always use the `technical-writer` skill ([`.agents/skills/technical-writer/SKILL.md`](./.agents/skills/technical-writer/SKILL.md)) when you write or edit prose for this repository, including documentation, `CONTRIBUTING.md`, commit messages, PR titles and descriptions, changesets, and issues.

## Code map

```
Input Script → Parser (src/parser/) → AST (src/ast/) → Interpreter (src/interpreter/) → ExecResult
```

| Path | Responsibility |
| --- | --- |
| `src/parser/` | Recursive descent parser producing AST nodes. `lexer.ts` tokenizes bash syntax (heredocs, quotes, expansions); `expansion-parser.ts` and `compound-parser.ts` handle expansions and compound commands. |
| `src/interpreter/` | AST execution. `interpreter.ts` holds the execution loop and command dispatch, alongside word expansion, arithmetic, conditionals, control flow, and `builtins/`. |
| `src/commands/` | One directory per command, holding its implementation and its tests. Commands are registered in `registry.ts`. |
| `src/commands/python3/` | CPython compiled to WebAssembly, running in a worker thread. |
| `src/commands/js-exec/` | Sandboxed JavaScript and TypeScript runtime built on QuickJS. |
| `src/fs/` | Virtual filesystem: `overlay-fs/`, `read-write-fs/`, `in-memory-fs/`, `mountable-fs/`, and the shared `real-fs-utils.ts` security helpers. |
| `src/security/` | Defense-in-depth layers, execution limits, and the security test suite. |
| `src/comparison-tests/`, `src/spec-tests/` | Cross-checking suites: recorded bash fixtures, and bash specification conformance with known failures. |

CLI usage and the interactive shell are documented in [packages/just-bash/README.md](./packages/just-bash/README.md#cli).
