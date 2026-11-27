---
"just-bash": patch
---

Convert stdin to bytes with a preallocated loop in `md5sum`/`sha*sum`, `base64`, `gzip`, `tar`, and `split`, and in the filesystem's `latin1`/`base64` writes, so a large input no longer aborts the process with "invalid array length".
