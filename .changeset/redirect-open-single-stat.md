---
"just-bash": patch
---

Check an output redirect target with one `stat` call instead of `exists` and `stat`

Every output redirect (`>`, `>>`, `&>`, and the rest) made one more filesystem call than it needed before opening its target. On a remote or database-backed `IFileSystem`, where each call is a round trip, `echo r > f` now makes 4 calls instead of 5, and `: > f` makes 2 instead of 3. A `stat` error other than `ENOENT` or `ENOTDIR` now fails the redirect with `cannot open redirect target`, even under `set -C`. Before, an `exists()` that swallowed the error let the redirect skip the noclobber check and truncate the file.
