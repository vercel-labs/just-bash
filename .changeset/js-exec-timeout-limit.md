---
"just-bash": patch
---

Fix `js-exec` stopping CPU-heavy scripts long before `maxJsTimeoutMs`: since 3.6.0 they ended after a few seconds with exit 124, however high the limit was set. The configured limit now also sets `run`'s CPU budget, and a CPU-limit stop reports the same exit 124 timeout. The wall-clock limit still counts queueing and host waits. A script that never finishes now runs for the full limit (30 seconds by default, 10 in the hardened profile) before it stops, so lower `maxJsTimeoutMs` if you relied on the earlier stop.
