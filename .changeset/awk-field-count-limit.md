---
"just-bash": patch
---

Bound `awk` field growth by `maxArrayElements`. Assigning to `NF`, to `$N`, or to a field through `sub`/`gsub` now fails with `field count limit exceeded` before allocating, instead of padding the record with millions of empty fields, and rebuilding `$0` checks the joined size against the string limit first.
