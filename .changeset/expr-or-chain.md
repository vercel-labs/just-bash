---
"just-bash": patch
---

Fix `expr` failing with a syntax error on a chain of `|` operators such as `expr 5 \| 6 \| 7` when an earlier operand is already true.
