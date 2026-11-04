---
"just-bash": patch
---

Fix `js-exec` killing CPU-bound scripts long before `maxJsTimeoutMs`. The `run` dependency is bumped from 2.1.3 to 2.1.8, `js-exec` now passes its configured timeout to `run` as `cpuTimeoutMs` as well as the wall-clock `timeoutMs`, and a `RunCpuTimeoutError` is reported as exit 124 with the usual `Execution timeout: exceeded <maxJsTimeoutMs>ms limit` message. Previously a synchronous loop was stopped after a few seconds by `run`'s own fixed interrupt/CPU budget while the error message blamed the configured limit.
