---
"just-bash": patch
---

`tail -c +N` now starts output at byte N, as GNU `tail` does, instead of ignoring the `+` and printing the last N bytes.
