# Automa source adaptations

This branch is based on upstream `7a2a7a57d46095bf6cc8195680a13f76f784681b`.
It replaces Automa's generated patches against the three minified just-bash
3.6.0 exports. The package keeps upstream's public entry points and version;
Automa records the exact fork commit, build inputs and artifact hashes in
`vendor/just-bash/VENDOR.json`. That commit, not `3.6.0`, identifies this fork.

## N00b migration ownership

| Former Automa generator or inline adaptation | Source owner | Regression coverage |
| --- | --- | --- |
| shell-flags: paste, grep, ls, sed, curl | `src/commands/{paste,grep,ls,sed,curl}/` | Command tests, binary backups/uploads and visible file errors |
| xargs-flags and parallel output sink | `src/commands/xargs/` | Attached options, logical lines, replacement, isolated ordered batches |
| rg-sort and globstar | `src/commands/rg/`, optional times in `src/fs/interface.ts` | Real metadata sorting, include/exclude and directory matching |
| sort-c-locale, sort keys, uniq count | `src/commands/{sort,uniq}/` | C/POSIX byte order, key modifiers, unique equality and formatting |
| od-read-bytes, checksum-operands | `src/commands/{od,checksum}/` | Byte bounds, `--`, missing/mixed operands and diagnostic streams |
| jq inline path updates, interpolation, equality and array difference | `src/commands/query-engine/` | Exact paths, literal escapes, unordered object equality and bounded comparison |
| jq keys, map-object, fromjson, index-types | `src/commands/query-engine/` | Zero/multiple results, scalar rejection, catch and resource limits |
| jq unicode-escapes, error-status, user-functions, walk | query parser/evaluator, `src/commands/jq/` | Unicode, CLI exit classification, lexical functions and bounded traversal |
| jq input and input-metadata | jq `input*.ts`, query-engine `input-state.ts` | Shared cursor, source locations, EOF, file errors and unsupported eager composition |
| awk FS, records, capture offsets, program files | `src/commands/awk/`, `src/regex/user-regex.ts` | Record cursor, RS/RT/FS, exact RE2 capture offsets, program files and limits |
| output-order and output-sink | `src/execution-output.ts`, `src/output-sink.ts`, interpreter FD/control flow | Ordered text/byte segments, backpressure, resource charging and cancellation |
| execution-failure and brace range | `src/Bash.ts`, `src/execution-scope.ts`, interpreter errors/expansion | Sticky invocation failures, partial output and nonrecoverable resource exhaustion |
| process-substitution-bytes and command-substitution-text | Interpreter substitution/expansion helpers | Private FD bytes, adjacent UTF-8 reconstruction, trailing newline removal and cleanup |
| utf8-data-bom and printf/echo bytes | `src/encoding.ts`, `src/Bash.ts`, `src/commands/{printf,echo}/` | BOM data, invalid UTF-8, exact byte escape output and budgets |
| trap-builtin | Interpreter `traps.ts`, lifecycle and set/shopt/exit | Frozen GNU Bash fixtures, ERR/EXIT, Stop and failure unwinds; unsupported RETURN/DEBUG fail explicitly |
| redirection-errno, directory globs, env inheritance | Interpreter redirections, `src/shell/glob.ts`, `src/Bash.ts` | COW-style EISDIR, trailing slash matching, `env ... bash -c` export inheritance |
| re2-compiler | `scripts/patch-re2js-compiler.mjs`, locked `patches/re2js@1.3.3.patch` | Complete programs/capture order and rejections for 46 patterns, including a 256 KiB native stack |

The RE2 change belongs to the separately versioned RE2JS dependency. Its generator
validates all three pristine dependency files before applying the iterative
compiler; it never searches minified just-bash output. Recreate with `pnpm patch
re2js@1.3.3 --ignore-existing --edit-dir <directory>`, run the generator on that
directory, then `pnpm patch-commit <directory>`. The original compiler remains
available internally for complete-program differential tests.

## Compatibility code removed or reduced

- Upstream seq/cut already propagate execution limits; no duplicate catch layer.
- Upstream jq evaluates index expressions against their original input; retain it.
- Upstream ENOENT/ENOTDIR redirection recovery remains; only EISDIR needed adapting.
- sed's pure rethrow wrappers are removed. Every added asynchronous filesystem
  operation retains the upstream defense-context check.
- Upstream awk errors can already carry the current output. Track its originating
  context by identity and prepend only missing parent output; do not compare or
  deduplicate text.
- Keep rg's file decoder BOM behavior separate from Shell output data decoding.
- Keep only the missing `replaceEnv` export-inheritance behavior; upstream's other
  nested-shell environment work does not remove that regression.
- Remove obsolete upstream expected-failure metadata for jq NUL strings,
  lexical filter parameters, input EOF, walk, typed indexing and object equality,
  and awk stdin getline. Preserve the original golden outputs. The awk spec
  parser now reads the preceding expected file when actual/expected temp files
  are reversed; the XML example fixture has repeated users for array indexing.
- The source migration audit also fixes function-definition redirection sinks,
  strict environment export inheritance and preservation of existing field limits.

Automa still owns its COW filesystem, revocable network/crypto capabilities,
Worker lifecycle and browser integration tests. Nothing here grants native
process execution or enables Python/JavaScript in Automa's Shell.

## Build, validation and future upgrades

Use Node 22.19.0 and the root `packageManager` pnpm 10.33.2 with the frozen lockfile.
Run `pnpm --filter just-bash build`, source tests, typechecking and banned-pattern
checks. Automa then builds and verifies all npm package artifacts from the exact
commit, including hydration and OID verification of the tracked CPython LFS file.
The artifact is packaged for fidelity; Automa's disabled Python policy is unchanged.
Browser, Node ESM and CJS integration coverage remains in Automa; source unit tests
alone do not certify a browser build or a real-model run.

No upstream pull requests have been submitted for these adaptations. On a future
upstream bump, rerun each owning regression against the new base and remove
changes already covered upstream. Preserve the original public contracts and
Automa's cancellation/partial-write boundaries. Never force-push away a commit
already referenced by a released `VENDOR.json`; retain it with a tag or another
branch before rebasing. Record upstream PR links here when they exist.
