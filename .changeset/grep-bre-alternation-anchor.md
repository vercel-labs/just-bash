---
"just-bash": patch
---

In a basic `grep` pattern, `$` right before `\|` is now an end-of-line anchor, as in GNU grep, instead of a literal `$`. `grep 'b$\|^c'` matches `ab` again, and repeated `-e` or `-f` patterns that end in `$` match, so autoconf's `AC_PROG_GREP` probe `grep -e 'GREP$' -e '-(cannot match)-'` accepts grep.
