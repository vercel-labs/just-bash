---
"just-bash": patch
---

Match real jq behavior for `to_entries` on arrays (numeric-key entries instead of null) and `tonumber` on empty or whitespace-only strings (error instead of 0).
