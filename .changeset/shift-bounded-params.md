---
"just-bash": patch
---

shift: move only the positional parameters that are set, so the work no longer grows with a host seeded `$#` and the result no longer depends on how many other variables exist. Slots with nothing behind them stay unset for `${N-word}` and `[ -v N ]`, while `set -u` now treats every `$N` up to `$#` as set. A `$#` above 2 ** 63 - 1 makes `shift` fail with a status of 1 instead of being parsed.
