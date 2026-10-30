---
"just-bash": patch
---

source and scripts run by path: pass every argument, not just the first nine

`source file a … k` and `./script a … k` set `$#` to 11 but left `${10}` and later empty, so `"$@"` and `for a; do` lost arguments after the ninth. Both now set every positional parameter, the way function calls and `set --` already do, and `source` restores all of the caller's parameters afterwards.
