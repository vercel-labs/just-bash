---
"just-bash": patch
---

awk: run every `END` statement when the last record ran `next` or `nextfile`

`awk '{ next } END { print "E1"; print "E2" }'` printed only `E1`, because the `next` flag from the last record was still set when `END` started. `END` now starts with `next` and `nextfile` cleared.
