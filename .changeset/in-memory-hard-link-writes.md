---
"just-bash": patch
---

Keep hard links coherent across writes in `InMemoryFs` and `OverlayFs`, counting each shared file entry once against the filesystem byte limit. Preserve inode metadata across writes and directory moves, and reject moves onto nonempty directories.
