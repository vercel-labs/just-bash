---
"just-bash": patch
---

shift: stop a seeded `$#` from crashing it

Before, a `$#` seeded far above the stored parameters (for example `new Bash({ env: { "#": "1000000000" } })`) made `shift` build one slot per `$#` and fail after seconds with `Invalid array length`. Now, when `$#` is larger than both the environment and `maxArrayElements`, `shift` moves only the parameters that are stored and leaves the missing ones unset, and every other case behaves exactly as before.
