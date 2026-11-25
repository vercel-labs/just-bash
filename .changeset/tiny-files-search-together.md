---
"just-bash": patch
---

Batch ripgrep's file-size checks so lazy filesystems can fetch metadata concurrently before content reads. Preserve the size limit, explicit operands, listing behavior, and read-time resource accounting.
