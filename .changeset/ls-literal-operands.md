---
"just-bash": patch
---

Resolve `ls` operands as literal paths instead of matching them as glob patterns a second time. Pathname expansion is the shell's job, so an operand still holding `*`, `?` or `[` is a real filename; re-matching it made `ls 'report [1].pdf'` report an existing file as missing and stripped the leading directories from names containing `?` or `*`.
