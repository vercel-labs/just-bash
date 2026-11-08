---
"just-bash": patch
---

shift: move only the positional parameters that are set, so the work no longer grows with a host seeded `$#`. Slots with nothing behind them stay unset, the result no longer depends on how many other variables exist, and a `$#` longer than 19 digits stops with an execution limit error instead of being parsed.
