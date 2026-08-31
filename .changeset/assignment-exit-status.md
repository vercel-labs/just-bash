---
"just-bash": patch
---

interpreter: give a bare assignment exit status 0 instead of the previous command's

A command with no command word — `x=1`, `arr=(a b)`, `> file`, a `$empty` that expands to nothing — reported whatever `$?` already held rather than success. Bash gives such a command status 0 unless a command substitution ran while expanding it.

The leak is invisible until something reads `$?`, and an `else` branch is where it bites: the branch runs with `$?` set to 1 by the condition that just failed, so an `else` branch ending in an assignment made the whole `if` report failure. Under `set -e` that ended the script with no output and no diagnostic:

```bash
set -e
if false; then :; else x=1; fi
echo done                          # never ran
```

A command substitution still sets the status where bash says it does. It counts from an assigned value or a redirection word, assignments expanded first and the last substitution winning: `x=$(exit 7)` is 7, `> /dev/null$(exit 5)` is 5, and `x=$(exit 7) > /dev/null$(exit 5)` is 5. A redirection onto fd 0 discards it and reports 0, matching bash 5.x, which forks a child to perform such a command's redirections. Process substitution never contributes, and neither does a command substitution in `PS4` under `set -x`.
