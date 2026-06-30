---
"just-bash": minor
---

sqlite3: translate `.tables`, `.schema`, `.mode`, `.read`, etc. so pasted CLI scripts work

Real `sqlite3` ships a set of dot-commands (`.tables`, `.schema`, `.mode csv`, `.read script.sql`, `.headers on`, `.separator`, …) that are a feature of the CLI, not the library. sql.js doesn't implement them, so agent scripts pasted verbatim from a real `sqlite3` session hit `near ".": syntax error` on the first dot-command.

This change adds a host-side preprocessor (`commands/sqlite3/dot-commands.ts`) that runs before SQL reaches the worker:

- **SQL replacement** — `.tables`, `.schema`, `.indexes`/`.indices`, `.databases`, `.help` are translated to `sqlite_master`/PRAGMA queries with glob → SQL-LIKE pattern conversion (`*` → `%`, `?` → `_`).
- **Formatter mutations** — `.headers`/`.header`, `.mode`, `.separator`, `.nullvalue` adjust output state for downstream SQL; bad arguments surface real-sqlite3-shaped errors (`Error: unknown mode: parquet`).
- **`.read FILE`** — recursively scans the included file (sharing formatter state, bumping depth, capped at `MAX_READ_DEPTH`).
- **`.quit` / `.exit`** — terminate preprocessing and drop subsequent input.
- **Silent drop** — recognize-and-discard for sandbox no-op commands (`.echo`, `.timer`, `.changes`, `.bail`, `.show`, `.eqp`, `.width`, `.prompt`, `.print`, `.explain`).
- **Not-implemented family** — `.dump`, `.save`, `.backup`, `.import`, `.clone`, `.restore`, `.open`, `.output`, `.shell`, `.system`, `.cd`, `.load`, `.iotrace`, `.log`, `.excel` translate to a `SELECT 'Error: …' AS error` so the message rides in stdout in script-order without aborting surrounding SQL.
- **Passthrough** — unknown dot-commands are left verbatim so sql.js produces its native syntax error.

The scanner is char-level with state for string literals (`'…'`, `"…"`, including the SQL `''`/`""` escapes) and comments (`-- …`, `/* … */`); a dot-command is recognized only at a boundary (start-of-input, after `;`, or after `\n`) and only outside strings/comments. This lets `'a\n.tables'` round-trip intact and lets `.headers on; .mode csv; CREATE TABLE…` be three tokens on a single line.

Also adds two CLI flags that pair with the preprocessor:

- `-init FILENAME` — read SQL from `FILENAME` before main SQL (matches real sqlite3).
- `-batch` — accepted as a no-op since just-bash is always non-interactive.

Dot-command errors are routed in-band to stdout (alongside SQL errors) when `-bail` is unset, matching real-sqlite3's single-channel reporting; with `-bail` they go to stderr and exit 1.
