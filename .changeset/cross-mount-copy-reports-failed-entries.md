---
"just-bash": patch
---

MountableFs: copy every other entry across mounts when one cannot be copied, then report the failures together

A recursive `cp` from one mount into another walks the tree entry by entry, and one entry the destination refuses ended the whole walk: everything after it was left uncopied, and the error named only that entry. The ordinary case is a symlink, since `ReadWriteFs` and `OverlayFs` refuse to create one unless `allowSymlinks` is set, so a tree holding a single link (a checked-out repository, a `node_modules`) failed on it with `EPERM: operation not permitted, symlink ...` and nothing to show for the rest.

The walk now continues past an entry it cannot copy, and once the tree is done throws one error naming the entries it could not copy, capped at ten, the way GNU `cp` reports each failed entry and exits 1 at the end. `cp -R` through `MountableFs` therefore leaves a usable copy with the links missing, and the error says which ones. A copy within one mount is that mount's own and is unchanged.
