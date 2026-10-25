---
"just-bash": patch
---

Fix a deadlock when concurrent `exec` calls write to the same `ReadWriteFs` root. Each queued mutation now starts in its caller's context instead of inside the execution of the mutation ahead of it, and is skipped in defense-in-depth enforcing mode if its caller's execution has already ended. Aborts while opening the copy source for `cp` and copy-on-write `chmod`, `utimes` and `appendFile` no longer leave the root locked. A skipped mutation's promise remains pending; settling it safely across command cancellation remains deferred to #379.
