---
"just-bash": patch
---

Keep leading blanks after `a\`, `i\` and `c\` in `sed` text, as GNU does, including blanks escaped with a backslash. The one-line `a text` form now strips every leading blank instead of only the first.
