---
"just-bash": patch
---

shift: move only the positional parameters that are set

`shift` built an array with one slot per `$#` before moving anything, so a `$#` seeded through the environment (for example `new Bash({ env: { "#": "1000000000" } })`) kept it busy for seconds and then failed with `Invalid array length`. It now moves only the numbered parameters that exist, so the work no longer grows with `$#`. The count, the out of range check and the resulting `$#` are unchanged.
