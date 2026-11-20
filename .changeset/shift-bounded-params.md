---
"just-bash": patch
---

shift: move only the positional parameters that are set, so the work no longer grows with a host seeded `$#` and the result no longer depends on how many other variables exist. Slots with nothing behind them stay unset for `${N-word}` and `[ -v N ]`, while `set -u` now treats every `$N` up to `$#` as set. A `$#` above 2 ** 63 - 1 makes every `shift` except `shift 0` fail with a status of 1, and `shift 0` still returns 0. `set --` now removes every stored parameter up to the old `$#` and the run of keys right above it, so a gap left by `shift` no longer keeps later keys alive.
