---
"just-bash": patch
---

Fix `ls -la` printing `Jan  1 00:00` for `.` and `..` by showing the real size and mtime of the directory and its parent.
