---
"just-bash": patch
---

Fix `${1+"$@"}` and the other default and alternative expansions whose word is `"$@"` so they expand to one word per positional parameter.
