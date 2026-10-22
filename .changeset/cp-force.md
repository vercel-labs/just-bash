---
"just-bash": patch
---

Accept `-f` / `--force` in `cp`, so scripts such as automake install rules that run `cp -f` no longer fail with `cp: invalid option -- 'f'`. As in GNU cp, when an existing destination file cannot be opened for writing, `cp -f` removes it and copies again, and `-n` takes precedence over `-f` in either order. The destination is left alone when the source cannot be read.

Only a confirmed destination-open failure can trigger replacement. Copy failures while writing, applying metadata, or committing a staging file no longer trigger destination removal.
