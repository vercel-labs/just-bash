---
"just-bash": patch
---

Bound `awk` field arrays by `maxArrayElements`. Assigning to `NF`, to `$N`, or to a field through `sub`/`gsub` now fails with `field count limit exceeded` before allocating, instead of padding the record with millions of empty fields. Splitting a record into fields (input records, `$0` assignment, `sub`/`gsub` on `$0`) stops at the same limit, so a record with more fields than `maxArrayElements` now fails with that error. Rebuilding `$0` checks the joined size against the string limit first, and a negative `NF` is rejected as in gawk.
