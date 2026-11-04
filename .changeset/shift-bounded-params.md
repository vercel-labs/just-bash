---
"just-bash": patch
---

shift: walk only the positional parameters that are set

`shift` read every slot up to `$#`, so a `$#` seeded through the environment (for example `new Bash({ env: { "#": "1000000000" } })`) made it build and rewrite a billion parameters until the process ran out of map space. It now stops at the first parameter that is not set, so the work follows the parameters that really exist.
