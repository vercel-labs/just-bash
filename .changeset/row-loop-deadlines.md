---
"just-bash": patch
---

Enforce `maxExecutionTimeMs` inside the data-command row loops

`ExecutionScope.throwIfAborted` was only reached at statement boundaries
(`chargeCommand` → `consume` → `assertUsable`), so the deadline could not bound a
single long-running statement. A `grep`/`jq`/`awk`/`sed` scan over a large input
ran to completion and *then* reported exit 124, having already spent the full
wall-clock cost.

The record loops now consult the scope directly: `awk` per input record, `sed`
per pattern-space line, the query evaluator (`jq`, `yq`) in `chargeQueryWork`,
and the search engine (`grep`, `rg`) in `chargeWork`, plus `grep`'s whole-file
prefilter on a miss. Cancellation latency is bounded by `DEADLINE_CHECK_STRIDE`
(1024) rows rather than by the length of the whole scan. The query evaluator's
`try`/`catch`, `?` and comma recovery paths now rethrow the deadline abort along
with the other fatal execution errors instead of converting it to a value.

The check is strided off the hot path — reusing a counter each loop already
maintains, so the added work per row is one integer compare against a local or
already-loaded field, not a call through the `CommandExecutionBudget` facade. On
a 99k-row JSONL input, `grep -c`, `jq -s 'map(.value) | add'`, `awk '{ t +=
length($0) }'` and `sed s///g` are unchanged within measurement noise.

**Not changed**: `ExecOptions.signal`. The loops stay synchronous and never
yield, so a host `AbortController` fired from a timer is still only observed
once the command returns; only the wall-clock deadline (a `Date.now()` poll) can
fire mid-scan. A single record whose own evaluation is unbounded (an `awk` rule
with a long inner `while`, one pathological regex) is still not interruptible,
and `sort` compares inside `Array.prototype.sort` remain outside the deadline.
