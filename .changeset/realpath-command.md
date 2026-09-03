---
"just-bash": minor
---

Add the `realpath` command. Canonicalizes names against the virtual filesystem — resolving `.`, `..` and symlinks — instead of exiting 127, with GNU's `-e`, `-m`, `-s`/`--no-symlinks`, `-L`, `-P`, `-q`, `-z`, `--relative-to` and `--relative-base`, GNU's default policy that every component but the last must exist, and GNU's diagnostics for a missing component, a path descending through a regular file, and a symlink loop.
