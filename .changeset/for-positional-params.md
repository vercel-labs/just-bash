---
"just-bash": patch
---

for: iterate each positional parameter when the loop has no `in` list

`for a; do …; done` and `for a do …; done` joined the positional parameters with spaces, split them on spaces again, and dropped empty ones, so `f "a b" "" c` looped over `a`, `b` and `c`. They now loop over `$1` through `$#` as given, like `for a in "$@"`.
