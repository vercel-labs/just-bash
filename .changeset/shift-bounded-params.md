---
"just-bash": patch
---

shift: stop a host seeded `$#` from hanging or crashing it

Before, `shift` walked every slot up to `$#`, so a `$#` seeded by the host hung or crashed it. Now, when `$#` exceeds both the stored entries and `maxArrayElements`, `shift` moves only the parameters that are set, and slots with nothing behind them stay unset rather than being filled with empty strings, a state only a host seeded `$#` can produce. Every other case is unchanged.
