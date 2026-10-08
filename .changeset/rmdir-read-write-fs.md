---
"just-bash": patch
---

ReadWriteFs: let `rmdir` and `find -delete` remove an empty directory. A non-recursive `rm` of a directory went to Node's `fs.promises.rm`, which refuses every directory without `recursive`, so both commands failed with `ERR_FS_EISDIR` where `InMemoryFs` and `OverlayFs` succeed. It now takes `rmdir(2)`, which removes an empty directory and refuses one that is not, after confirming the entry and its parent have not changed since they were validated. `ln -f` no longer removes a directory standing where the link goes; it reports `cannot overwrite directory`, as GNU `ln` does.
