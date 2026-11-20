---
"just-bash": patch
---

Report `ReadWriteFs` lookup errors such as `ENOTDIR` and `EACCES` when a symlink-free path inside the root explains the failure. Failures through symlinks, including `ELOOP`, keep the generic sandbox rejection.
