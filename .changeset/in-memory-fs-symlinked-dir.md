---
"just-bash": patch
---

Follow symlinked directories when changing files in `InMemoryFs`. With `lnk` a symlink to a directory, `echo hi > lnk/a.txt` reported success but stored nothing that could be read back, and `rm`, `mv`, `touch` and `chmod` on `lnk/...` failed with "No such file or directory". Writes, appends, `mkdir`, `rm`, `cp`, `mv`, `chmod`, `ln`, `ls` and `readlink` now act on the real directory. A symlink in the last part of a path is handled as before.
