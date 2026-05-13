---
"just-bash": patch
---

curl: interpret `@file` for `-d`/`--data`, `--data-binary`, and `--data-urlencode`

Real curl reads file contents when these flags are passed `@filename`:

- `-d @file` / `--data @file` — read file contents, strip CR/LF.
- `--data-binary @file` — read file contents verbatim (newlines preserved).
- `--data-urlencode @file` — read file, URL-encode the contents.
- `--data-urlencode name@file` — prefix the URL-encoded contents with `name=`.

just-bash's curl previously passed `@filename` through verbatim as the HTTP body. Posting JSON or any non-trivial payload via `curl --data-binary @payload.json https://…` sent the literal string `@payload.json` instead of the file. The new behavior matches upstream curl; `--data-raw` keeps the documented "no `@` interpretation" semantics.
