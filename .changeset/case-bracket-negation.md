---
"just-bash": patch
---

Support `[!...]` negation, and a literal `]` right after `[!`, in `case` and `[[ == ]]` patterns. Bracket expressions there are now converted the same way as in filename globs and `${var#pattern}`, so `case $v in *[!_a-zA-Z0-9]*)` no longer takes the wrong branch.
