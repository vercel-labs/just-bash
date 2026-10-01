# Contributing to just-bash

Thanks for helping improve just-bash. This guide covers how to contribute: setting up the repository, making a change, the constraints the implementation must respect, and the maintenance process used to triage what comes in.

## Setting up

just-bash is a pnpm monorepo. It requires Node.js `>=20.19` and pnpm.

```sh
pnpm install
pnpm build     # required before anything reads dist/
pnpm test:run  # unit, comparison, and spec tests
```

These commands run from the repository root, where each script delegates to the packages. A single package's script runs with `pnpm --filter <name> <script>`, and test paths are relative to the package that owns them, so a single test file needs the filter too:

```sh
pnpm test:unit          # fast unit tests
pnpm test:comparison    # recorded bash fixtures
pnpm test:wasm          # python3, sqlite3, js-exec
pnpm test:dist          # smoke-test the built package (after pnpm build)
pnpm typecheck
pnpm lint               # biome, per-package banned-pattern checks, and workflow security checks
pnpm knip

pnpm --filter just-bash test:run src/commands/grep/grep.basic.test.ts  # a single test file
```

Spec tests have known failures, so exclude them when you want a clean run: `pnpm test:run --exclude src/spec-tests`.

Tests run from source. Build first only when you need to exercise the compiled output under `dist/`.

## Making a change

The implementation must match real bash, not what is convenient for TypeScript. A command that behaves differently from bash is a bug, so check real bash whenever you are unsure. Intentional differences exist where bash cannot be supported without escaping the sandbox, such as unrestricted writes, free network access, and commands that would need host resources the sandbox does not provide.

Work on one change at a time. Add its tests, verify the behavior, and only then move to the next command or fix.

### Implementation constraints

- Do not add dependencies that use WebAssembly. The existing exceptions, `sql.js` for SQLite and the vendored CPython build, are already in place and are not precedent for more. Binary npm packages are fine.
- Install dependencies with `pnpm` rather than editing `package.json` by hand.
- 64-bit integers are explicitly unsupported.
- Parsing and execution must never hang, so every path needs a reasonable compute limit.

### Adding a command

Commands live in `packages/just-bash/src/commands/<name>/`:

1. An implementation file with a usage statement.
2. Unit tests in a collocated `*.test.ts` file.
3. Comparison tests in `src/comparison-tests/` when the behavior is uncertain.

Commands error on unknown options unless real bash also ignores them, and `--help` reflects what the command actually supports rather than what bash prints.

### Debugging

`pnpm dev:exec` reads a script from stdin, executes it, and prints the result. Use it to inspect behavior instead of writing a throwaway test file.

```sh
echo 'echo hello' | pnpm dev:exec
echo 'x=5; echo $((x + 3))' | pnpm dev:exec --real-bash             # also run the system bash and compare
echo 'for i in 1 2 3; do echo $i; done' | pnpm dev:exec --print-ast # print the parsed AST
```

`--root <path>` executes against a real directory, and `--no-limit` lifts the execution limits for large scripts. `--real-bash` runs the script through the system bash outside the sandbox, so pass it only input you are willing to execute on the host.

### Testing

- **Unit tests** are fast and isolated, so edge cases belong here.
- **Comparison tests** compare output against recorded bash fixtures, which removes the differences between macOS and Linux. Add them for major command functionality and whenever you are unsure about bash behavior. Write them with `setupFiles()` and `compareOutputs()`; see [`src/comparison-tests/README.md`](./packages/just-bash/src/comparison-tests/README.md).
- **Spec tests** cover bash specification conformance and include known failures.

Assert the full stdout and stderr rather than matching fragments, because a partial match hides the surrounding behavior. Keep test files under 300 lines, and start a new file when you need another group.

When you need to pin down how bash actually behaves, write the comparison test and record the fixture rather than probing with a one-off script. The recorded fixture then locks that behavior for everyone.

To record fixtures:

```sh
RECORD_FIXTURES=1 pnpm --filter just-bash test:run src/comparison-tests/mytest.comparison.test.ts  # re-record one file
RECORD_FIXTURES=force pnpm test:comparison  # re-record everything, overwriting locked fixtures too
```

Commit the generated fixture file together with the test. If you adjust a fixture for Linux behavior, mark it `"locked": true` so later re-recordings leave it alone.

### Security requirements

just-bash executes untrusted scripts, so the sandbox boundaries are part of the contribution contract. [`THREAT_MODEL.md`](./THREAT_MODEL.md) covers the attack surface, the trust boundaries, and the residual risks that are accepted rather than fixed.

#### Filesystem access

`OverlayFs` and `ReadWriteFs` default to `allowSymlinks: false`, so `symlink()` throws `EPERM`, any path that traverses a real-filesystem symlink is rejected, and `readdir()` lists symlink entries that cannot be used. `lstat()` and `readlink()` still inspect a symlink without following it.

Validation is central. `packages/just-bash/src/fs/real-fs-utils.ts` holds the shared gates: `resolveCanonicalPath` and `resolveCanonicalPathNoSymlinks` canonicalize a real path, check that it is still inside the canonical root, and return the path to use for I/O, or `null` when the path escapes the root or traverses a symlink. ReadWriteFs wraps them in `resolveAndValidate`; OverlayFs wraps them in `resolveRealPath_`.

When you add a filesystem method, route real-filesystem access through those gates and use the path they return for the actual I/O. Never call `fs.promises.stat()`, `fs.realpathSync()`, or similar on an unvalidated path, and prefer `fs.promises.open()` over `fs.promises.readFile()`/`writeFile()`. A gate is not enough on its own: validation and use are not atomic, and `O_NOFOLLOW` binds only the final component, so an intermediate directory can still be swapped between the two. ReadWriteFs opens data I/O with `O_NOFOLLOW` and re-validates after `mkdir()`; a new method needs its own equivalent checks for the operations it performs.

Pass `allowSymlinks: true` in tests that exercise symlink behavior. `src/fs/cross-fs-no-symlinks.test.ts` covers the default-deny behavior and the `O_NOFOLLOW` protection.

#### Prototype pollution

User-controlled data (stdin, arguments, file contents, HTTP headers, environment variables) can become JavaScript object keys, so every `Record<string, T>` that can hold a user-controlled key needs a null prototype. The banned-patterns linter, which `pnpm lint` runs, rejects patterns such as `= {}`, `Object.fromEntries()`, `Object.assign({}, ...)`, and `.hasOwnProperty()`.

- Static lookup tables: `nullPrototype()` from `src/commands/query-engine/safe-object.ts`.
- Empty accumulators: `Object.create(null)`.
- Objects built from user data: `nullPrototypeCopy()` and `nullPrototypeMerge()` rather than object spread, and `safeSet()` for individual writes. The same module also exports `safeFromEntries()`, `safeAssign()`, and `safeHasOwn()`.
- Bundled workers, which cannot import `safe-object`: `Object.assign(Object.create(null) as Record<string, string>, { ... })`.
- Self-referential types, where `Object.assign` breaks inference: `Object.setPrototypeOf(map, null)`, with a `@banned-pattern-ignore` comment on the line above it.

`src/helpers/env.ts` provides `mapToRecord()`, `mapToRecordWithExtras()`, and `mergeToNullPrototype()` for environment maps. Never read `obj[userInput]` on a plain `{}`; guard with `Object.hasOwn()`, or store the data in a `Map` or a null-prototype object.

Add a test whenever new code stores user-controlled keys. Exercise `constructor`, `__proto__`, `prototype`, `hasOwnProperty`, `toString`, and `valueOf`, and assert that `Object.prototype` is unchanged afterward. Existing coverage lives in `src/interpreter/prototype-pollution.test.ts`, `src/security/prototype-pollution/`, and collocated `*.prototype-pollution.test.ts` files.

### Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Whether a change ships is a separate decision; see [Releases](#releases).

If an AI coding agent writes any of your contribution's prose, including commit messages, PR descriptions, changesets, documentation, and issues, it must use the [`technical-writer` skill](./.agents/skills/technical-writer/SKILL.md).

## Repo maintenance

Repository maintenance covers dependencies, CI, tooling, and internal work that does not change how just-bash behaves for users. Maintainers triage it through the issue labels below.

### Issue labels

Each issue form applies one type label automatically.

| Label | Meaning |
| --- | --- |
| `bug` | Existing behavior is wrong |
| `enhancement` | A capability is missing, or should work differently |
| `documentation` | Documentation needs a correction or an addition |
| `chore` | Repository maintenance: dependencies, tooling, CI, or internal work |

GitHub's `good first issue` and `help wanted` labels are also in use for triage.

Topic labels group related issues, so it is easy to see which issues belong to the same area of the project. They are additive: an issue can have several, and a change that spans areas can have several. Maintainers add them during triage, so you do not need to add them yourself.

| Label | Scope |
| --- | --- |
| `shell` | Parsing, quoting, expansion, pipelines, redirection, and shell execution |
| `commands` | Behavior of, or support for, individual commands |
| `filesystem` | Filesystem implementations, mounts, links, and file operations |
| `security` | Sandbox boundaries, trust, and vulnerability reports |
| `compatibility` | Running or bundling just-bash in browsers, Node.js, Bun, and other hosts |
| `api` | Programmatic interfaces for embedding just-bash: configuration, callbacks, and execution results |
| `network` | HTTP behavior, network permissions, and request configuration |
| `dependencies` | Dependency updates and dependency-related problems |
| `ci` | Automated checks and GitHub Actions |

### Closing issues

Add one of these only when it applies:

- `duplicate`: another issue or pull request already covers it. Link that item.
- `wontfix`: the change will not be made. Give a short reason.

Close resolved issues as **Completed**, and link the fix or explain the resolution. Use **Not planned** when you close without pursuing a change.

### Releases

This repository uses [Changesets](https://changesets.dev/guide/getting-started), so commit types do not trigger releases. Only add a changeset when you intend to release the change, and be deliberate about why package users need that release. Add one with `pnpm changeset`.
