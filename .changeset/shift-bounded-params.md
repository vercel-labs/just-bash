---
"just-bash": patch
---

shift: stop a seeded `$#` from crashing it

Before, a `$#` seeded so high that filling every slot would pass the JavaScript limits (`Invalid array length` or `Map maximum size exceeded`) made `shift` run for seconds and then fail. Now, only in that case, `shift` moves just the stored parameters and counts `$#` down exactly, and every case that worked before gives the same result.
