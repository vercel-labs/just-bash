---
"just-bash": patch
---

Fix `${#@}` and `${#*}` to report the number of positional parameters, like `$#`, instead of the character length of the joined `"$@"` string (so `set -- a b c; echo ${#@}` prints `3`, not `5`). This fixes sub-case 3 of #758; the other four sub-cases in that issue remain open.
