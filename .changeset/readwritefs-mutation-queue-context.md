---
"just-bash": patch
---

Fix `ReadWriteFs` roots that stayed locked for the life of the process when concurrent executions wrote into them. The mutation queue now waits and releases with `await`, and runs each mutation in the trusted scope, so defense-in-depth can no longer drop its settle or release callbacks when an execution finishes first, is aborted mid-write, or the mutation came from host code or a defense-off `Bash`.
