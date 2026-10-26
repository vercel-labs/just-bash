---
"just-bash": patch
---

`printf` accepts the C length modifiers `h`, `hh`, `l`, `ll`, `L`, `j`, `z` and `t` and ignores them, as bash does, instead of failing with `[sprintf] unexpected placeholder`, so `printf '%ld %lld %zu\n' 1 2 3` works. A modifier in front of `%` (`%l%`) is rejected, as in bash.
