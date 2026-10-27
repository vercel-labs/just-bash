---
"just-bash": patch
---

`mv` no longer creates missing destination parent directories: like bash, it fails with ENOENT when the parent is absent and ENOTDIR when a component in the path is not a directory.

Write through a symlinked destination parent so a moved file stays reachable, and report the real reason a parent lookup failed instead of folding ENOTDIR, ELOOP and EACCES into "No such file or directory".
