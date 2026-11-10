---
"just-bash": patch
---

Fix a deadlock when concurrent executions write into the same `ReadWriteFs` root. A mutation queued behind another execution's mutation now runs in the context of the execution that queued it, so defense-in-depth no longer drops its callbacks when the other execution finishes first. Previously the queued write never settled and the root stayed locked for the life of the process.
