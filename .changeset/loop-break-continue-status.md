---
"just-bash": patch
---

interpreter: give a loop left via `break`/`continue` status 0 instead of the last command's

`break` and `continue` are builtins that return 0, and they are the last command a loop body runs. A loop exited through them reported the status of whatever ran *before* the `break` instead:

```bash
while :; do false; break; done; echo $?            # was 1, bash says 0
for i in 1; do false; break; done; echo $?         # was 1, bash says 0
for i in 1 2; do false; continue; done; echo $?    # was 1, bash says 0
```

All four loop forms were affected — `for`, C-style `for`, `while`, `until` — as was a `break`/`continue` in a `while` condition and a multi-level `break 2` unwinding through an enclosing loop.

The stale status is invisible until something reads `$?`, and under `set -e` the phantom failing loop ends the script with no output and no diagnostic:

```bash
set -euo pipefail
while :; do
  [ 5 -eq 0 ] && break     # correctly exempt from errexit as the left operand of &&
  break
done
echo ok                    # never ran
```

`$?` moves with the status, so the next iteration sees it too — a `for` loop runs nothing between the `continue` and the next iteration's first command, and would otherwise still expose the failure there:

```bash
for i in 1 2; do echo "$i:$?"; false; continue; done   # was 1:0 2:1, bash says 1:0 2:0
```

`continue` sets the status at the point it runs but does not pin it: a later iteration still overwrites it, so `for i in 1 2; do if [ $i = 1 ]; then true; continue; fi; false; done` is still 1. A loop that ends normally is unchanged and reports its last command, and `return` from a function still reports the last command rather than 0.

Reported downstream as ai-ecoverse/slicc#2978.
