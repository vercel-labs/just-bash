---
"just-bash": patch
---

`ls -l` now prints each entry's permission bits in the mode column, using the same formatter as `stat -c %A`. It used to print `-rw-r--r--` for every file and `drwxr-xr-x` for every directory. Under `-a`, the `.` and `..` rows show the mode, size and date of the listed directory and its parent.

Symlinks still list as their target, because `ls -l` reads entries with `stat`, not `lstat`.
