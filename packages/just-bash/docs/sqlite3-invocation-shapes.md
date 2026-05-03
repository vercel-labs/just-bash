# sqlite3 invocation shapes — agent parity catalogue

This index tracks how reasoning agents actually invoke `sqlite3` in production
(via the `bash` tool) and our parity status. Source: a Braintrust review of
~924 spans across the four `flowglad-pay-agent*` projects in 2026-04.

Each shape maps to one or more pinning tests under
`src/commands/sqlite3/sqlite3.{invocation-shapes,sql-features,dot-commands,flags}.test.ts`.
If a test in this directory regresses, an agent in production has hit (or will
hit) the same failure.

This file is the **triage list** — the GitHub issue tracker is disabled on
this fork, so deferred work lives here. Update the **Status** column when
patches land.

## Shell invocation shapes

| ID  | Shape                                                       | Status        | Test |
| --- | ----------------------------------------------------------- | ------------- | ---- |
| S1  | `sqlite3 :memory: "SELECT sqlite_version();"`               | Supported     | invocation-shapes / S1 |
| S2  | `which sqlite3 && file $(which sqlite3)` (capability probe) | **Partial**: `file` builtin missing | — |
| S3  | `sqlite3 <db> "<single SQL>"`                               | Supported     | invocation-shapes / S3 |
| S4  | `sqlite3 <db> "stmt1; stmt2; stmt3"`                        | Supported     | invocation-shapes / S4 |
| S5  | `sqlite3 <db> < /workspace/file.sql` (script redirect)      | Supported     | invocation-shapes / S5 |
| S6  | `echo "<SQL>" \| sqlite3 <db>` (stdin pipe)                 | Supported     | invocation-shapes / S6 |
| S7  | `sqlite3 <db> "$(cat file.sql)"` (command substitution)     | Supported     | invocation-shapes / S7 |
| S8  | `sqlite3 -header -separator $'\t' <db> "..."` (TSV+header)  | Supported     | invocation-shapes / S8 |
| S9  | `sqlite3 -separator $'\t' <db> "..."` (TSV no header)       | Supported     | invocation-shapes / S9 |
| S10 | `sqlite3 <db> "..." > /workspace/out.tsv`                   | Supported     | invocation-shapes / S10 |
| S11 | Per-statement loop (sequential calls)                       | Supported     | invocation-shapes / S11 |

## SQL features

| ID  | Feature                                                  | Status    | Test |
| --- | -------------------------------------------------------- | --------- | ---- |
| F1  | `CREATE TABLE … AS SELECT …`                             | Supported | sql-features / F1 |
| F2  | Bulk `INSERT` blocks from script-redirected `.sql`       | Supported | sql-features / F2 |
| F3  | Window functions (`SUM(...) OVER (PARTITION BY ...)`)    | Supported | sql-features / F3 |
| F4  | CTEs (`WITH x AS …`) including `WITH RECURSIVE`          | Supported | sql-features / F4 |
| F5  | `strftime('%Y-%m', …)`, `strftime('%Y-W%W', …)`          | Supported | sql-features / F5 |
| F6  | `sqlite_master` introspection                            | Supported | sql-features / F6 |
| F7  | `CASE WHEN`, scalar subqueries                           | Supported | sql-features / F7 |
| X4  | `PRAGMA table_info(t)` and friends                       | Supported | sql-features / X4 |

## Dot-commands

| ID  | Command                              | Status                 | Test |
| --- | ------------------------------------ | ---------------------- | ---- |
| D1  | `.tables [pat]`                      | Supported (one-name-per-line, not multi-column) | dot-commands / D1 |
| D2  | `.schema [pat]`                      | Supported              | dot-commands / D2 |
| D3  | `.headers on/off` (alias `.header`)  | Supported              | dot-commands / D3 |
| D4  | `.mode <list\|csv\|json\|line\|column\|table\|markdown\|tabs\|box\|quote\|html\|ascii>` | Supported (last-mode-wins limitation) | dot-commands / D4 |
| D5  | `.separator <col> [<row>]`           | Supported              | dot-commands / D5 |
| D6  | `.nullvalue <text>`                  | Supported              | dot-commands / D6 |
| D7  | `.read <file>` (recursive)           | Supported              | dot-commands / D7 |
| D8  | `.import <file> <table>`             | **Deferred — see Open work / D8** | dot-commands / D8 (todo) |
| D9  | `.dump`                              | **Deferred — see Open work / D9** | dot-commands / D9 (todo) |
| —   | `.help .show .timer .changes .bail .echo .eqp .width .prompt .print .explain` | Accepted as no-op | — |
| —   | `.import .dump .clone .save .restore .backup .open .shell .system .iotrace .log .cd .load .excel` | Rejected with explicit error | dot-commands / "explicitly unsupported" |

## Flags

| ID  | Flag                                  | Status    | Test |
| --- | ------------------------------------- | --------- | ---- |
| —   | `-list -csv -json -line -column -table -markdown -tabs -box -quote -html -ascii` | Supported | options / output-modes |
| —   | `-header / -noheader / -separator / -newline / -nullvalue / -readonly / -bail / -echo / -cmd / -version / --` | Supported | options |
| X1  | `-init <file>`                        | Supported | flags / X1 |
| X2  | `-batch`                              | Supported (no-op) | flags / X2 |

## Limitations

- **Float precision**: `ROUND(x, 2)` does not emit clean two-decimal output.
  just-bash mirrors real sqlite3's full IEEE-754 precision (`999.99` →
  `999.99000000000001`). Agents who need clean cents should compute in
  integer cents. Pinned in invocation-shapes / S8.
- **Last-mode-wins**: dot-commands that mutate formatter state (`.mode`,
  `.headers`, `.separator`, `.nullvalue`) apply globally to the entire
  invocation, not incrementally. Real sqlite3 applies them statement by
  statement. Pinned in dot-commands / "interleaved mode + query".
- **`.tables` format**: one name per line, not real sqlite3's 3-column
  space-padded format. Easier to parse, but a divergence.

## Open work (deferred)

### D8: `.import <file> <table>` — load CSV/TSV into a table

Real sqlite3 uses `.import` to ingest CSV/TSV. Agents currently work around
this by translating CSV → `INSERT` statements via `awk`, which is slow and
brittle. Trace evidence: ~22 invocations of the awk-then-script pattern in
the sample of 200 spans.

**Suggested approach**: implement in `dot-commands.ts`. Parse
`.import [--csv|--ascii] [--skip N] FILE TABLE`. Read FILE via `ctx.fs`,
parse with the existing papaparse dep, translate to `INSERT INTO TABLE
VALUES (...)` statements appended to the SQL stream.

**Test pin**: `sqlite3.dot-commands.test.ts` has `it.todo` under
`describe("D8: .import")`. Flip to `it(...)` once implemented.

### D9: `.dump` — emit schema + INSERTs reproducing the database

Walk `sqlite_master`, emit every `CREATE TABLE/INDEX/VIEW/TRIGGER` with a
trailing `;`, then `SELECT *` from each table to generate `INSERT INTO ...
VALUES (...)` lines. Wrap in `BEGIN; ... COMMIT;`.

**Test pin**: `sqlite3.dot-commands.test.ts` has `it.todo` under
`describe("D9: .dump")`.

### X3: `ATTACH DATABASE 'other.db' AS o` to real-FS file paths

sql.js is a sandboxed WASM build with no real-FS access. `ATTACH` to a path
opens an empty in-memory database, not the file the agent expects.

**Suggested approach**: pre-process `ATTACH DATABASE 'path' AS alias` —
read `path` via `ctx.fs`, load it into sql.js as an in-memory DB, register
under `alias`. Write back on exit if modifications detected. Non-trivial:
need a multi-buffer worker protocol.

**No test pin yet** — file under
`sqlite3.invocation-shapes.test.ts` if/when added.

### S2: `file` builtin missing

`which sqlite3 && file $(which sqlite3)` — `file` is not a just-bash builtin.
This isn't strictly a sqlite3 issue; it's a gap in the command set. Agents
use it to verify the binary type during capability probes.

**Suggested approach**: add `file` as a stub in `src/commands/file/` that
inspects the magic bytes of the target file and reports an extension-based
type. Doesn't need full libmagic — just enough to identify ELF, Mach-O,
PE, ASCII text, JSON, gzip, zip, sqlite, etc.

## When this catalogue should be re-run

Pull a fresh sample any time:

- A `flowglad-pay-agent*` project's prompt set materially changes.
- We bump `sql.js` (regression risk for SQL features).
- An agent reports a new failure mode involving `sqlite3`.

Re-run via the Braintrust SQL-query MCP:

```sql
-- across the four flowglad-pay-agent* projects
WHERE output::text ILIKE '%sqlite3%'
ORDER BY created DESC
LIMIT 200
```

Then update the tables above and add new pinning tests.
