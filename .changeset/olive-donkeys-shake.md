---
"just-bash": patch
---

Interleave stdout and stderr in write order when a duplication operator sends both to one place, so `{ echo a; echo b 1>&2; echo c; } 2>&1` is `a b c` rather than `a c b`.
