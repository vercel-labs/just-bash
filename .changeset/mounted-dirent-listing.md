---
"just-bash": patch
---

Implement `readdirWithFileTypes` on `MountableFs`, the one filesystem in the package that did not have it, so a walk through a mounted layout reads each directory once instead of stating every entry in it. `find <dir> -type f` over 21,000 files went from 734ms to 101ms on macOS and from 8.4s to 383ms on Windows. Entries a filesystem gives no type for, including the `DT_UNKNOWN` that NFS and FUSE answer with, are resolved with `lstat` in batches of `DEFAULT_BATCH_SIZE`, as `ls` and `tree` already do for themselves.
