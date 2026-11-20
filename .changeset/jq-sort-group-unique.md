---
"just-bash": patch
---

Fix jq `group_by`, `unique` and `sort_by` to match jq 1.7: `group_by` returns groups sorted by key, `unique` returns values sorted, and `sort_by` compares every key expression (`.a, .b`) instead of only the first. The same key-sequence comparison now applies to `unique_by`, `min_by` and `max_by`.
