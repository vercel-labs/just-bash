---
"just-bash": patch
---

Print `sed` `n` output in command order with `p`, `=` and `l` instead of ahead of them, and keep the newline of lines `n` printed before the last input line. `printf 'a\nb\nc' | sed 'n;n;d'` now prints `a\nb\n` as GNU sed does.
