---
"just-bash": patch
---

shift: when a host seeded `$#` exceeds both the number of stored variables and `maxArrayElements`, move only the parameters that are set, leaving empty slots unset and keeping `$#` exact; below that bound nothing changes.
