---
"just-bash": patch
---

Implement awk `asort(source [, dest [, how]])` so arrays can be sorted by value like gawk; previously the call silently returned an empty string and left the array unchanged.
