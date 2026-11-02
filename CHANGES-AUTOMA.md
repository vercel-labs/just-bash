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

Pi's selected find/grep tools pass the private `--automa-respect-ignore` option
when filtering recursive results by glob. It prevents a positive glob from
overriding ignore-file exclusions, using the existing traversal and ignore
manager. Raw `rg` retains native override behavior; hidden-file, explicit-file,
type, sorting and execution-budget rules are unchanged.

## MR 53 output-accounting follow-up

Multi-level `break`/`continue` unwinds retain already-charged output credits,
including redirected bytes. Output process-substitution writers carry credits
for their actual captured descriptor writes; direct backing-file replacement
cannot borrow unrelated output credits. Capture limits poison the shared
invocation during `return`/`exit` cleanup, close the remaining descriptors and
preserve successful writer output on the original control-flow error. These
changes keep the existing resource thresholds and public package interfaces.

## N1 rg high-frequency flags

- Port `--no-heading` and ordered `--messages`/`--no-messages` controls from
  [upstream PR #712](https://github.com/vercel-labs/just-bash/pull/712) and
  [upstream PR #705](https://github.com/vercel-labs/just-bash/pull/705). File-error
  suppression preserves exit status and never hides argument, regex or fatal
  resource errors. The owning changes are in `rg-options.ts`, `rg-parser.ts`,
  `rg-search.ts`, `rg.ts`, and the N1 regression tests.
- Add `-M`/`--max-columns`, preview and its negation through the shared search
  formatter. Matching/counting still uses the same bounded regex engine;
  rendering tests byte length, preserves Unicode previews, and retains context,
  replacement, only-matching and JSON behavior. New metadata and formatting work
  obey existing execution limits; grep does not enable these options.
- Count `-u` occurrences independently of existing hidden/ignore flags. Add the
  real `--binary` behavior for `-uuu`, retaining ordered `--text` overrides and
  prospectively accounting the binary scan representation. Remove the old
  state-based escalation helper, whose inference incorrectly promoted a single
  `-u` after `--hidden`/`--no-ignore`.
- Reuse upstream explicit `./` prefixes, negative globs, file listings and
  symlink traversal unchanged. Native comparison also exposed an unnecessary
  multiline group separator when no context was requested; remove it and
  correct its prior unit-test expectation. Vimgrep output retains its required
  filename prefix for a single explicit file.
- Record new, separate fixtures against native ripgrep **14.1.1** for N1. Existing
  ripgrep 15.2.0 fixture recordings remain unchanged. Source and comparison tests
  cover `rg`, the shared formatter and unaffected `grep`; they do not claim
  browser or real-model validation.

## N2a find, xargs and wc

- Adapt `find -mmin`/`-newermt` from [upstream PR #555](https://github.com/vercel-labs/just-bash/pull/555),
  reusing the existing date timezone parser. Native GNU find 4.10.0 comparison
  corrects the PR's minute rounding and the older `-mtime +N` comparison. Capture
  one reference time for a traversal. Missing `-newer` references fail visibly.
- Add expression-aware `find -quit`: only a reached action stops traversal,
  pending `-exec ... +` effects still flush, and later paths are not inspected.
  Preserve the existing batched traversal for commands without `-quit`. Add `%y`
  and native fractional `%T@` formatting; existing path/depth/negation predicates
  remain shared with the original evaluator.
- Adapt virtual argument-file reading from [upstream PR #714](https://github.com/vercel-labs/just-bash/pull/714),
  adding prospective memory reservation and cumulative input accounting. Keep
  option operands separate from child argv. `-d`/`-0` preserve empty fields and
  non-delimiter newlines; empty input runs once unless `-r`/`-I`/`-L` suppress it.
  `-P` executes sequentially with GNU status aggregation, including stop-on-255.
  Remove the parallel buffering branch and the false-success executor fallback.
- Match GNU regular-file `wc` column widths using total byte sizes rather than a
  fixed three-column minimum; remove the redundant per-column map/spread passes.
- Give argument-file children one private stdin description with a shared read
  cursor. Partial `head`/`read` consumption, descriptor duplicates, nested shells,
  redirected groups and pipelines preserve their own bindings without replaying
  the original input. Keep the public command context and Harness unchanged.
- Add separate native findutils 4.10.0/coreutils 9.7 fixtures and resource/action
  regressions, including multiple children sharing an argument-file input stream.

## N2b stat, date and explicit environment facts

- Add `stat --format`/`--printf` (last option wins), byte-preserving escapes,
  `%Y`/`%y`/`%h`/`%i`, and symlink-aware type/mode formatting. Formatting checks
  output and operation budgets while appending. Reuse the shared escape and
  strftime implementations; remove the old allocating replacement pass.
- Add `date -r`/`--reference`, native ISO precision controls (`-I` is date-only,
  `-Iseconds` includes a colon offset), RFC formatting, and millisecond timestamp
  fractions. Validate ISO calendar/DST gaps instead of silently normalizing them.
  Existing `-u` now controls parsing as well as display. Reference-file errors
  and cancellation remain visible.
- Optional `environmentInfo` supplies an explicit host arch/timezone snapshot;
  no `TZ` entry is created. Explicit `TZ` (including empty) and `-u` take
  precedence. Without an adapter the fork keeps its UTC display default.
  `find -newermt` reuses the same timezone resolution.
- Optional `virtualFileMetadata` supplies display-only user/group, uid/gid,
  link count, directory size and allocation-unit estimates for a virtual FS.
  Absent backend inode identity is shown as `0`, never a fabricated stable inode.
  The option defaults preserve the fork's existing identity/block values.
- Frozen coreutils 9.7 comparisons cover UTC and Asia/Shanghai without globally
  normalizing timestamps, modes or output. Owning tests cover explicit host
  defaults, binary escapes, unsupported resources and cancellation.

## N2c shared permission metadata

- Extract chmod's numeric/symbolic parser as `parseFileMode(mode, currentMode,
  isDirectory)`, exported from both public entries for embedding commands.
  `X` checks directory/executable identity; invalid modes fail before effects.
  chmod reuses it, with the same export available to mkdir and host install.
- Port the regular/lazy overwrite-mode preservation from
  [upstream PR #578](https://github.com/vercel-labs/just-bash/pull/578) to
  InMemoryFs. Explicit metadata wins, and newly created files retain defaults.
  This targets the virtual filesystem's stored permission bits; no POSIX
  privilege or inode semantics are inferred for browser storage.
- Owning tests and recorded GNU coreutils 9.7 fixtures verify restricted modes,
  executable rewrites, conditional execute bits, special bits and rejection.

## N2c file command flags

- Add `cp -a/-d/-u/-T/-t` and functional `-p`/`--preserve=all`, with per-file
  no-clobber/update decisions. Preserve file and directory modes/timestamps,
  and canonicalize parent paths before mutation. Keep the source-tree preflight
  and retain its bounded, prospectively reserved plan, removing the second
  recursive walk and the old accepted-but-ignored preserve branch.
- Copy timestamp values into owned Dates before writing metadata; revocable
  command-context Date proxies must not escape into the filesystem. A request
  to preserve symlink timestamps fails visibly with ENOTSUP after any completed
  copy. No non-following timestamp API exists, so the target is never modified
  to pretend success; partial writes remain visible.
- `mkdir -m` reuses `parseFileMode`; `-p` preserves existing modes and verbose
  output names only newly created entries. Add actual `ln -n` directory-symlink
  behavior, relative symlink targets, dangling-link replacement and canonical
  parent handling. Remove the ignored `-n` compatibility branch.
- Existing mktemp directory/temporary-path/dry-run options already match native
  behavior; keep that implementation and propagate fatal filesystem failures.
  InMemoryFs rejects ordinary/lazy writes over directories with EISDIR, retaining
  their children. Native fixtures cover flags and bounded/COW-style regressions.

## N7 transfer controls and explicit cookie export

- Curl supports bounded `--retry` with the native transient HTTP status set
  (408/429/500/502/503/504), recognizable network failures and timeout exit 28.
  Retries require an explicit flag, consume the existing execution budget, and
  stop on revocation, policy rejection or resource failure. The retry delay is
  cancellable; enclosing command deadlines remain authoritative.
- `-m` and `--connect-timeout` validate finite decimal values. Fetch does not
  expose connection timing, so the latter is an explicitly documented whole
  request bound; the host still caps time and bytes. `%{time_total}` measures
  elapsed transfer time, with status/size/effective URL written exactly once.
  The existing `-L` opt-in policy and response-header output remain intact.
- Remove the raw Set-Cookie-as-jar fallback. `-c` requests a complete Netscape
  jar through optional `SecureFetchOptions.wantCookieJar` /
  `FetchResult.cookieJar`; only a capable trusted host provides it. The standard
  transport rejects export before dispatch. File writes use the supplied FS,
  `-c -` emits bytes on stdout, and unavailable/failed exports never succeed.
  Cookie input (`-b`), session filtering (`-j`) and manual Cookie overrides fail
  explicitly pending a separately isolated browser transport.
- Local real-curl HTTP comparisons cover retries, timeout and redirect metrics;
  source tests cover cancellation, policy errors, unsupported capability and
  jar output. Browser cookie permissions and host identity remain Automa-owned.

## N8 shell metadata and small builtins

- Initialize `BASH_VERSION` and readonly indexed `BASH_VERSINFO` from the
  Bash 5.2.37 compatibility target, with the injected architecture in element 5.
  Version values are ordinary shell state: declarations, scalar assignment,
  array protection and clean child-shell startup reuse the existing machinery.
  Array declaration output now retains its readonly/export/integer attributes.
- `caller` reads bounded function/source frames, preserving call-site lines,
  source filenames, nesting, returns and subshell isolation. Unsupported options
  and invalid numeric arguments fail visibly.
- Fatal nounset expansion exits the command-string shell with 127 and isolated
  subshells with 1. Function, eval, source, group and loop unwinds preserve output
  and reach the existing EXIT-trap boundary instead of continuing the script.
- `times` prints two pairs of fixed zero virtual CPU counters. Its help explicitly
  distinguishes them from actual CPU measurements; wall time is never substituted.
  Native Bash fixtures cover syntax, output shape and exits, alongside source
  tests for host architecture injection and the virtual-counter contract.
- Reuse the existing `hash -r` and `printf %(...)T` implementations after native
  comparison. Optional `coproc`/`select` parsing remains outside this change.

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

## N5b cryptographic checksum family

- Register SHA-224/384/512 and BLAKE2b-512 commands through the shared checksum
  verifier. SHA-1/256/384/512 retain one WebCrypto digest call site, allowing
  Automa's existing private digest broker to supply the capability.
- Add exact `@noble/hashes@2.4.0` (MIT) for incremental SHA-224/BLAKE2b and replace
  the duplicate synchronous MD5 implementation with its incremental MD5. Retain
  the license in the package's `THIRD_PARTY_NOTICES.md` and distributable inventory.
- Reserve file/hash/manifest memory prospectively, charge cumulative input and
  work, yield CPU hashing for cancellation, and release temporary reservations.
  Keep fatal resource/cancellation failures distinct from ordinary file errors.
- Match GNU binary markers and escaped filenames; consume stdin once, reject
  empty/all-malformed manifests, and reject manifests read from stdin that also
  name stdin as a data source. Verification warnings use stderr, file failures
  continue subsequent inputs, and ordered output segments preserve redirects.
- Add frozen native coreutils 9.7 comparisons for all four new commands plus
  binary vectors, shared budget and cancellation regressions for the full family.

## N7 transfer review

- Charge retransmitted request bytes and discarded response/cookie bytes to the
  same input budget; permission, resource and cookie-export errors cannot retry.
- Preserve UTF-8 write-out text alongside binary bodies and exported jars, and
  substitute response metadata literally without interpreting it as format syntax.
- On transport failure, report the actual normalized GET query and last-attempt
  duration, excluding retry delay and local file work. The current fetch error
  contract supplies no partial response metadata; do not invent status or bytes.
- Reject missing values for existing parameter options before network dispatch.
  Add source regressions and a local native-curl failure-timing comparison.

## N4 long directory listings

- Reuse the shared real-mode formatter and overwrite-preserving file modes already
  implemented for N2b/N2c (the behavior covered by upstream PRs #577/#564 and
  #578/#565). Avoid layering a second permission implementation over them.
- Align size columns across each operand/listing block, estimate allocated blocks
  through one shared ls/du helper, use GNU human-size rounding, and support
  custom, long-iso and full-iso timestamps with the injected host timezone.
- Apply A12's identity, link count and directory-size values only through the
  existing virtualFileMetadata injection; keep ordinary filesystem metadata when
  the override is absent. Preserve symlink mode, target text and classification.
- Honor the order of -a/-A, keep dot entries in sorted -F output, and avoid following
  symlink directories in the recursive fallback. Append recursive results directly
  in their established order instead of retaining and sorting them a second time.
- Record GNU coreutils 9.7 comparisons, normalizing only box:box owner and link
  counts to A12's user:user/1. Keep traversal, output and cancellation boundaries.
