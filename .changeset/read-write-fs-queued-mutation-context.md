---
"just-bash": patch
---

Fix a deadlock when concurrent `exec` calls write to the same `ReadWriteFs` root. Each queued mutation now starts in its caller's context instead of inside the execution of the mutation ahead of it, and is skipped if that execution has already ended. Aborted `cp` and copy-on-write `chmod`, `utimes` and `appendFile` no longer leave the root locked.
