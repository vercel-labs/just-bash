---
"just-bash": patch
---

Fix `ReadWriteFs` misreporting real lookup failures as sandbox escapes: when `realpath` fails with `ENOTDIR`, `EACCES`, `ELOOP` or another errno, the path is inside the root, so the real errno is now reported (for example `ENOTDIR: not a directory, realpath '/notes.txt/child'`) instead of `EACCES: ... resolves outside sandbox`. Genuine escapes still fail closed with the sandbox message, and `OverlayFs` keeps its fail-closed behavior.
