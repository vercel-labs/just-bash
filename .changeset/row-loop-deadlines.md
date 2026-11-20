---
"just-bash": patch
---

Enforce `maxExecutionTimeMs` inside the data-command row loops

The existing deadline checks could not interrupt the inner loops of some data commands. A long scan could continue past the deadline until the next existing check.

The row loops now consult the scope during `awk` processing, `sed` cycles, and `jq` and `yq` evaluation. `grep` and `rg` check during search and at file boundaries. The checks run every 1024 records, cycles, or charged work units, depending on the command. A single work unit can process multiple rows or a whole string. In particular, grep's whole-file prefilter can scan a file before its next check.

Query recovery and command handlers now rethrow fatal execution errors instead of converting them to ordinary results. This also prevents `yq -i` from writing a recovered result after a deadline.

**Not changed**: `ExecOptions.signal`. The loops stay synchronous and never
yield, so a host `AbortController` fired from a timer is still only observed
once the command returns; only the wall-clock deadline (a `Date.now()` poll) can
fire mid-scan. A single record whose own evaluation is unbounded (an `awk` rule
with a long inner `while`, one pathological regex) is still not interruptible,
and `sort` compares inside `Array.prototype.sort` remain outside the deadline.
