---
"just-bash": patch
---

jq: a function body sees the variables in scope where the function is defined

`1 as $x | def f: $x; 2 as $x | f` printed 2, the value of `$x` where `f` is called. jq prints 1. A function body now reads the variables of its definition. A variable that is defined only where the function is called now reads as `null` in the body. jq rejects such a filter.
