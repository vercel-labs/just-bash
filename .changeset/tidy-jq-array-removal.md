---
"just-bash": patch
---

Fix jq array removal with `-=` and `del(.arr[] | select(...))`. Arithmetic assignments now reuse the corresponding binary operators, and filtered paths retain their locations through iteration and pipes. Delete selected paths against the original input so duplicate paths and multiple array matches do not shift the remaining indexes.
