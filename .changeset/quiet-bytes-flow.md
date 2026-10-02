---
"just-bash": minor
---

Fix `js-exec` Buffer encoding defaults, UTF-8 reads, typed-array inputs, character-boundary writes, and range validation. Reduce temporary allocations in byte conversion, `tr`, and `sed` while preserving execution limits.
