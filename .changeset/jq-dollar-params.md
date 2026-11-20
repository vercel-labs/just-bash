---
"just-bash": patch
---

jq: bind `$name` function parameters

`def f($a): $a + 1; f(2)` printed 1 because `$a` was null in the body, and the filter `a` was not defined. As in jq, `def f($a; $b): body` now means `def f(a; b): a as $a | b as $b | body`. The body runs once for each combination of argument values, with the first parameter as the outer loop.

A `$name` parameter with the name of a builtin, such as `$length`, reads the builtin instead, because a builtin takes precedence over a user definition with the same name.
