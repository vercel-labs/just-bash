---
"just-bash": patch
---

Fix jq array removal with `-=` and `del(.arr[] | select(...))`. Arithmetic assignments now reuse the corresponding binary operators, and filtered paths retain their locations through iteration and pipes. Delete selected paths against the original input so duplicate paths and multiple array matches do not shift the remaining indexes. Unsupported arithmetic operand pairs now raise errors, deletion accepts path-preserving type filters, and array subtraction compares nested objects independently of key order while enforcing query work and depth limits.
