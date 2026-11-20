---
"just-bash": patch
---

Keep the indentation of a line that continues the previous one through a trailing backslash. Stripping it fused the words on either side of the removed backslash-newline, so `awk -f x.awk a.h\` followed by an indented `b.h` read a single `a.hb.h` argument.
