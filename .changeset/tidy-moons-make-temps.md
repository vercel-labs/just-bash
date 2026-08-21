---
"just-bash": minor
---

Add the `mktemp` command. It creates a unique temporary file (mode 0600) or directory (`-d`, mode 0700) and prints its path, supporting `-p`/`--tmpdir[=DIR]`, `-t`, `-u`/`--dry-run`, `-q`/`--quiet`, `--suffix=SUFF`, GNU-style `TEMPLATE` expansion, `--help` and `--version`. The default directory is `$TMPDIR` when set and non-empty, otherwise `/tmp`, so sandboxed embedders that point `TMPDIR` at a writable directory get a usable path. Random name characters come from the platform CSPRNG (`crypto.getRandomValues`), and existing paths are never returned.

Adds an optional `createExclusive(path, { mode, directory })` method to `IFileSystem`, which creates an entry only if the name is free and applies the mode at creation time rather than via a follow-up `chmod`. All built-in filesystems implement it; the member is optional, so external `IFileSystem` implementations remain source compatible and fall back to the best-effort path in the new `createExclusiveOn` helper. The accompanying `CreateExclusiveOptions` type is exported alongside the existing `MkdirOptions`/`RmOptions`.
