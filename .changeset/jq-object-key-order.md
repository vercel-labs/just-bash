---
"just-bash": patch
---

Compare jq objects without regard to key order, as jq does. `{"a":1,"b":2} == {"b":2,"a":1}` is now `true`, and `!=`, `unique`, `unique_by`, `group_by`, array `-`, `index`, `indices` and `IN` treat two objects that differ only in key order as the same value.
