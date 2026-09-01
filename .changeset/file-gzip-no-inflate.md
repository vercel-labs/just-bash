---
"just-bash": patch
---

Report gzip files from their header instead of inflating them. `file` no longer enters `file-type`'s nested gzip probe, which decompressed up to 16 MB of input to look for an inner tar and leaked an `AbortError` unhandled rejection after the command had already returned. Gzipped tar archives now read as `gzip compressed data` rather than `gzip archive data`, matching `file`.
