---
"just-bash": patch
---

Fix `js-exec` stopping CPU-heavy scripts long before `maxJsTimeoutMs`: since 3.6.0 they ended after a few seconds with exit 124, however high the limit was set. The configured limit now also sets `run`'s CPU budget, and a CPU-limit stop reports the same exit 124 timeout. The wall-clock limit still counts queueing and host waits. `maxJsTimeoutMs` defaults to 30 seconds, or 10 in the hardened profile, and `run` caps its timeout at 2,147,483,647 ms, including when `maxJsTimeoutMs` is `Infinity`. If the outer `maxExecutionTimeMs` deadline is reached first, `exec()` returns exit 124. Lower `maxJsTimeoutMs` if you relied on the earlier stop.
