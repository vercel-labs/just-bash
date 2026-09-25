---
"just-bash": patch
---

Keep `InMemoryFs` hard links coherent across writes while counting the shared file body once against the filesystem byte limit. Preserve symlink entries and inode metadata when moving files in `OverlayFs`.
