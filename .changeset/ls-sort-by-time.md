---
"just-bash": patch
---

Implement `ls -t`. The flag was parsed and discarded, so `ls -lt` silently returned the same name-ordered listing as `ls -l` while `--help` documented it as "sort by time, newest first". `-S` and `-t` now follow GNU's precedence, where whichever is written last wins, and both break ties by name so a listing no longer depends on the order the filesystem returned entries in. Sort keys come from `lstat`, so a symlink orders on its own size and mtime rather than its target's.
