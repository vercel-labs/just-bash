---
"just-bash": patch
---

Truncate toward zero in `awk` `int()` and in the `%d` and `%i` conversions of `awk` `printf`, as awk does, so `int(-3.7)` is `-3` rather than `-4` and `printf "%d", -0.5` prints `0` rather than `-1`.
