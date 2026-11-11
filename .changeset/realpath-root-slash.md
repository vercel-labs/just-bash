---
"just-bash": patch
---

Keep the leading slash in `ReadWriteFs.realpath()` when the root is `/`. The same canonical-to-virtual conversion now covers `cp` and readlink targets, so paths under a filesystem root stay absolute.
