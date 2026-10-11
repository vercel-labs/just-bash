---
"just-bash": patch
---

Report a failed read by its errno. `cat`, `head`, `tail`, `wc`, `sort` and the other commands that read through `readFiles`, `grep`, `ls`, `stat` and `tree` printed `No such file or directory` for every error a filesystem threw, so a file the filesystem refused to read with `EACCES` was reported as missing. They now print the message for the error's code (`Permission denied`, `Not a directory`, `Is a directory`, `Input/output error`, ...), and `No such file or directory` for `ENOENT` and any error without a known code, as before.
