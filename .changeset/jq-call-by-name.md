---
"just-bash": patch
---

jq: evaluate filter arguments of a function you define when the function uses them

Before, `def f(x): ...` evaluated each argument once, at the call, and kept the values. Now an argument is a filter that runs each time the function uses it, as in jq.

- An argument that the function does not use is not run. `def f(x): 1; f(error("x"))` prints 1.
- An argument that the function uses twice is run twice. `def f(x): [x, x]; f(1,2)` prints `[1,2,1,2]`.
- An argument reads `.` where the function uses it. `def f(x): 5 | x; 1 | f(.)` prints 5.
- An argument sees the variables and functions of the caller, not those of the function.

Functions such as `def mymap(f): [.[] | f]` and `def myuntil(cond; update): ...` now give the same results as jq.
