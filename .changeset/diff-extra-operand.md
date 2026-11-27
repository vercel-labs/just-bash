---
"just-bash": patch
---

`diff` now rejects more than two file operands with `diff: extra operand '<file>'` and exit status 2, as GNU diff does. Previously it compared the first two operands and silently ignored the rest, so a glob that expanded to several files produced a plausible but wrong comparison.
