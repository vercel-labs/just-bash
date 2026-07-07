# just-bash

## 3.0.3

### Patch Changes

- [#277](https://github.com/vercel-labs/just-bash/pull/277) [`aec5643`](https://github.com/vercel-labs/just-bash/commit/aec56431d7d9b6fcb141bbfe25d26f4931f54f80) Thanks [@mutewinter](https://github.com/mutewinter)! - interpreter: avoid lazy import in variable assignment path that trips defense-in-depth (fixes [#273](https://github.com/vercel-labs/just-bash/issues/273))

  Any non-`export` variable assignment (bare `SECRET=s`, prefixed `SECRET=s cmd`,
  or before a custom command) failed with a defense-in-depth security violation
  (`dynamic import of Node.js builtin 'node:module' is blocked during script
execution`), while plain commands and `export`-ed assignments passed.

  `processScalarAssignment()` resolved `isArray` via `await import("./expansion.js")`
  in two spots. In the bundled `dist`, that dynamic `import()` marks `expansion.js`
  as a lazily-linked chunk whose `createRequire` banner imports `node:module`; the
  defense layer's ESM `resolve` hook blocks that builtin import when the sandbox is
  active and untrusted, so it blocked just-bash's own chunk load. The file already
  statically imports from `./expansion.js`, so `isArray` is now pulled from that
  static import and the two lazy imports are removed — no lazy `node:module`-bearing
  chunk is linked at runtime. No public API change.

- [#276](https://github.com/vercel-labs/just-bash/pull/276) [`1ec5eec`](https://github.com/vercel-labs/just-bash/commit/1ec5eec0aefd099d23ac9f056df1e6612c81d49b) Thanks [@mutewinter](https://github.com/mutewinter)! - interpreter: preserve leading whitespace in multi-line quoted strings (fixes [#259](https://github.com/vercel-labs/just-bash/issues/259))

  `exec()` runs each script through `normalizeScript()`, which `trimStart()`s
  leading indentation from lines so indented template-literal scripts parse. It
  was applied line-by-line and stripped the leading whitespace inside multi-line
  single- and double-quoted strings too. The visible symptom was `python3 -c
'...'` (and `node -e`, `awk`, etc.) with an indented body failing with
  `IndentationError`, while the same code via heredoc or pipe worked.

  `normalizeScript()` is now quote-aware (mirroring the earlier heredoc-aware
  fix): it only strips indentation from lines that begin outside any quote, and
  preserves lines that begin inside an unterminated single- or double-quoted
  string verbatim. This also un-skips four sed spec tests whose indented stdin
  was previously being corrupted.

- [#286](https://github.com/vercel-labs/just-bash/pull/286) [`cb2b583`](https://github.com/vercel-labs/just-bash/commit/cb2b583b3f46e6bb4e6982c4bfe19903ec811a87) Thanks [@privatenumber](https://github.com/privatenumber)! - interpreter: deliver redirected output to each fd's final target (fixes `cmd > file 2>&1` leaking stderr to stdout)

  `applyRedirections()` processed a command's redirection list sequentially over
  the result's stdout/stderr strings, moving content at each step. The
  duplication operators (`2>&1`, `1>&2`) merged into the live stream regardless
  of where the source fd pointed, so the canonical `cmd > file 2>&1` wrote
  stdout to the file but leaked stderr onto the caller's stdout — including
  "command not found" errors and custom-command stderr. Any wrapper protocol
  that parses the enclosing script's stdout (e.g. a runner emitting a JSON
  payload after `eval "$CMD" > "$OUT" 2>&1`) saw the leaked stderr corrupt its
  stream. Ordering variants were wrong in other ways: `cmd 2>&1 > file` put
  stderr in the file instead of on stdout, and `cmd > a > b` wrote content to
  `a` instead of `b`.

  The pass now mirrors how bash sets up fds before running the command: each
  output redirection only opens/truncates its target and re-points the fd's
  sink (file, /dev/null, or a snapshot of the caller-visible stream), and
  duplication operators copy the source fd's current sink. Stream content is
  delivered once, after the whole list is processed, to each fd's final sink.
  This makes `cmd > file 2>&1` send stderr to the file, `cmd 2>&1 > file` keep
  stderr on the caller's stdout, `cmd > all 2>&1 2> err` let the later `2> err`
  reclaim stderr, and `cmd > a > b` truncate `a` while writing content to `b`.
  The `/dev/null`-as-regular-VFS-file behavior for stdout redirects is
  preserved.

## 3.0.2

### Patch Changes

- [#272](https://github.com/vercel-labs/just-bash/pull/272) [`150a915`](https://github.com/vercel-labs/just-bash/commit/150a915a1d45a2cc7f2b6aec3268f27116c34916) Thanks [@trieloff](https://github.com/trieloff)! - interpreter: fix UTF-8 mojibake when a script interleaves text-output and byte-output statements

  A single `exec()` can interleave text-shaped statements (sed, awk, echo — `ö`
  as `U+00F6`) with byte-shaped ones (grep | head, cat — `ö` as bytes
  `0xC3 0xB6`). `executeScript` / `executeStatement` concatenated each result's
  raw stdout, so the lone high byte from the text half made the combined stream
  invalid UTF-8, the output-boundary decoder bailed, and the byte half came back
  as Latin-1 mojibake (`KÃ¶penicker` for `Köpenicker`). The same path backs
  command substitution, so `echo "你好: $(cat /file)"` was affected too.

  The fix decodes each statement/pipeline result to text via its explicit
  `stdoutKind` (`decodedTextFromResult`) before concatenating — no guessing from
  string contents, so text whose code units merely look like UTF-8 (`Ã¶`) is
  preserved. `tac` (stdin path) and `curl` (response body) now declare
  `stdoutKind: "bytes"` on the results that forward raw bytes, so the decode is
  driven per output rather than by inspecting characters.

- [#256](https://github.com/vercel-labs/just-bash/pull/256) [`75d8dfd`](https://github.com/vercel-labs/just-bash/commit/75d8dfd3a322786250e3b0f81b1500c87610acb7) Thanks [@Hazzng](https://github.com/Hazzng)! - js-exec: fix Buffer shim correctness — ascii encode now uses & 0xff (not & 0x7f), consolidate latin1/ascii into shared \_rawEncode, fix Buffer.from(ArrayBuffer, offset, length), throw on invalid byteLength input, clamp negative toString start, throw RangeError for out-of-range write offset

- [#239](https://github.com/vercel-labs/just-bash/pull/239) [`1369b77`](https://github.com/vercel-labs/just-bash/commit/1369b772fe887694c09ce834d1b0b21aa6420b59) Thanks [@trieloff](https://github.com/trieloff)! - curl: interpret `@file` for `-d`/`--data`, `--data-binary`, and `--data-urlencode`

  Real curl reads file contents when these flags are passed `@filename`:

  - `-d @file` / `--data @file` — read file contents, strip CR/LF.
  - `--data-binary @file` — read file contents verbatim (newlines preserved).
  - `--data-urlencode @file` — read file, URL-encode the contents.
  - `--data-urlencode name@file` — prefix the URL-encoded contents with `name=`.

  just-bash's curl previously passed `@filename` through verbatim as the HTTP body. Posting JSON or any non-trivial payload via `curl --data-binary @payload.json https://…` sent the literal string `@payload.json` instead of the file. The new behavior matches upstream curl; `--data-raw` keeps the documented "no `@` interpretation" semantics.

- [#262](https://github.com/vercel-labs/just-bash/pull/262) [`4ece258`](https://github.com/vercel-labs/just-bash/commit/4ece2580d8cb707e6c6b7fa22897ea3fdd21739a) Thanks [@chernetsov](https://github.com/chernetsov)! - parser: don't treat quotes inside a heredoc body as shell quotes when finding the end of a command substitution

  A command substitution whose body contained a heredoc with an unbalanced quote in its body — most commonly an apostrophe in literal prose, e.g. `June's` — failed to parse with `bash: syntax error: ... unexpected EOF while looking for matching ')'`:

  ```bash
  OUT=$(cat <<'SCRIPT'
  June's moon
  SCRIPT
  )
  ```

  Both the lexer's `$(...)` word scanner and the substitution boundary scanner walked into the heredoc body and applied shell quote tracking to it. The `'` in `June's` opened a single-quoted string that never closed, so the closing `)` was swallowed and the scan ran to EOF. In bash a heredoc body is literal text and must be skipped wholesale when locating the substitution boundary.

  Both scanners are now heredoc-aware: when scanning a `$(...)` they recognize `<<` / `<<-` operators (but not the `<<<` here-string), capture the possibly-quoted delimiter, and skip the heredoc body lines literally — without quote or paren tracking — up to the terminator. Multiple heredocs on one line and tab-stripping (`<<-`) are handled. This fixes the common pattern of capturing the output of a connector/CLI invocation that is fed a heredoc script containing apostrophes, backticks, or parentheses.

  The heredoc scan also tracks arithmetic `((...))` nesting so a `<<` left-shift inside `$((...))` (or a nested arithmetic expansion) is not mistaken for a heredoc opener — previously a multi-line arithmetic expansion containing a shift, e.g. `$((\n1 << 2\n))`, had its closing `))` swallowed by spurious body-skipping.

- [#248](https://github.com/vercel-labs/just-bash/pull/248) [`d64009a`](https://github.com/vercel-labs/just-bash/commit/d64009aef6bc1556e7c84b22ed455863275ea953) Thanks [@Hazzng](https://github.com/Hazzng)! - perf(grep): up to 14.5× speedup via preFilter extensions and matcher reuse.

  Anchored alternation patterns like `^def \|^async def` now extract literal needles (stripping outer `^`/`$`), enabling the `String.indexOf` fast-path. Files with no matching needle are rejected before `split("\n")`, skipping RE2 entirely. `acquireMatcher()` extended to `match()`, `replace()`, `search()`, and `matchAll()` to reduce GC pressure across awk/sed hot-paths.

- [#261](https://github.com/vercel-labs/just-bash/pull/261) [`c9904de`](https://github.com/vercel-labs/just-bash/commit/c9904dea24ad2aa847749ee6289239c2a2c651fc) Thanks [@chernetsov](https://github.com/chernetsov)! - set: support a bundled `-o`/`+o` long option inside a short-flag cluster (e.g. `set -euo pipefail`)

  The `set` builtin previously rejected `set -euo pipefail` with `bash: set: -o: invalid option`, because it parsed each character after the `-` as an independent short flag and has no `o` short flag. `-o` was only honored as its own token (`set -eu -o pipefail`).

  This is the canonical "bash strict mode" idiom and is extremely common in generated scripts, so the whole script would abort on its first line.

  `set` now matches bash: an `o` inside a cluster consumes the _next word_ as its long-option name, and the remaining characters keep being parsed as short flags. So `set -euo pipefail` is equivalent to `set -e -u -o pipefail`, `set -oe pipefail` enables both `pipefail` and `errexit`, trailing words become positional parameters, and `+`-clusters (`set +euo pipefail`) disable the options. An invalid bundled name (`set -euo bogus`) still reports `invalid option name`, and an `o` with no following argument falls back to the standalone `-o`/`+o` listing.

## 3.0.1

### Patch Changes

- [#238](https://github.com/vercel-labs/just-bash/pull/238) [`01a4721`](https://github.com/vercel-labs/just-bash/commit/01a4721324350adea4b035b311f0b60ccdbb65ff) Thanks [@cramforce](https://github.com/cramforce)! - Fix `Dynamic require of "tty" is not supported` crash when invoking commands that transitively load `debug` / `supports-color` (notably `file`) under ESM Node consumers and via the `just-bash` CLI binary.

  The esbuild dynamic-require shim emitted into the ESM Node bundles had no `require` to delegate to at chunk-init under ESM, so any runtime `require("tty")` / `require("os")` from `file-type` → `debug` chain threw. Build banners now provide `createRequire(import.meta.url)` for `build:lib`, `build:cli`, and `build:shell`. CJS and browser bundles are unchanged.

  Fixes [#211](https://github.com/vercel-labs/just-bash/issues/211).

## 3.0.0

### Major Changes

- [#233](https://github.com/vercel-labs/just-bash/pull/233) [`7cca738`](https://github.com/vercel-labs/just-bash/commit/7cca73831987e3331160f426b7a66d7217b8cf79) Thanks [@cramforce](https://github.com/cramforce)! - Breaking change for stdin byte/utf8-handling. Will break some custom commands that handle stdin

### Minor Changes

- [#209](https://github.com/vercel-labs/just-bash/pull/209) [`b3bd85e`](https://github.com/vercel-labs/just-bash/commit/b3bd85ed816445e6d148290163a1900f49ebea82) Thanks [@cramforce](https://github.com/cramforce)! - Introducing plumbing for integrating executor and adding a peer package for the implememtation

- [#233](https://github.com/vercel-labs/just-bash/pull/233) [`7cca738`](https://github.com/vercel-labs/just-bash/commit/7cca73831987e3331160f426b7a66d7217b8cf79) Thanks [@cramforce](https://github.com/cramforce)! - TS-enforced correct handling of utf8 on stdin. Impacts many commands

## 2.14.5

### Patch Changes

- [#214](https://github.com/vercel-labs/just-bash/pull/214) [`da58f4f`](https://github.com/vercel-labs/just-bash/commit/da58f4f523c5e9c1c444106a0f2a7777a59fb618) Thanks [@subsetpark](https://github.com/subsetpark)! - jq: accept control characters inside JSON strings

- [#221](https://github.com/vercel-labs/just-bash/pull/221) [`a835686`](https://github.com/vercel-labs/just-bash/commit/a835686c97f5cac2e5b94bd551d996079a33dfc2) Thanks [@cramforce](https://github.com/cramforce)! - upgrade deps

- [#218](https://github.com/vercel-labs/just-bash/pull/218) [`13d78b2`](https://github.com/vercel-labs/just-bash/commit/13d78b2876d7ac7b6bc3a6eacfa3937bbb79665f) Thanks [@Hazzng](https://github.com/Hazzng)! - grep: 5-123x faster pattern matching via RE2 matcher reuse and literal pre-filter

## 2.14.4

### Patch Changes

- [#206](https://github.com/vercel-labs/just-bash/pull/206) [`6ccc35f`](https://github.com/vercel-labs/just-bash/commit/6ccc35f5a9b5c6f395b145ed2ec7ee71c4862057) Thanks [@subsetpark](https://github.com/subsetpark)! - Fix awk lexer to honor POSIX statement continuation across newlines after `,`,
  `{`, `&&`, `||`, `?`, `:`, `do`, `else`, `if`, and `while`. Previously, a
  multi-line idiom like `printf "%s=%d\n", \n  $1, $2` (comma at end-of-line
  followed by indented args on the next line) failed with `Unexpected token:
NEWLINE` because the lexer emitted a NEWLINE token unconditionally. The
  lexer now suppresses the NEWLINE when it immediately follows one of the
  continuation-allowing tokens, matching POSIX awk.

- [#212](https://github.com/vercel-labs/just-bash/pull/212) [`733c847`](https://github.com/vercel-labs/just-bash/commit/733c84796e3abbd05a25cf67805bf4b030d0b02d) Thanks [@cramforce](https://github.com/cramforce)! - Bug fixes across network, sqlite3, xan, rg, terminal rendering, and CI

## 2.14.3

### Patch Changes

- [#199](https://github.com/vercel-labs/just-bash/pull/199) [`3d11f05`](https://github.com/vercel-labs/just-bash/commit/3d11f05959faa205267a5173b25665c6732fee8b) Thanks [@cramforce](https://github.com/cramforce)! - Internal: convert repository to a pnpm workspace under `packages/just-bash` and adopt Changesets for versioning. No public API changes; `import` paths and the `bin` entries are unchanged.
