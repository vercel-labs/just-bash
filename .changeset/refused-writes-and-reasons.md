---
"just-bash": patch
---

A refused write fails the command, not `exec()`, and commands say why a file operation failed

A redirect whose target the filesystem refuses (`EROFS`, `EACCES`, `EPERM`, `EISDIR`, `ENAMETOOLONG`, `EINVAL`, `ENOSPC`, and the like), at open or when the content is delivered, used to reject the whole `bash.exec()` call or, inside a loop, end the loop. It now fails alone with `bash: /ro/f.txt: Read-only file system`, `$?` is 1, and the script continues (#603). An error that names none of these errnos still propagates. `<` and `<>` name the reason too, and `tee`, `sed` (including `-i`), `cat`, `head`, `tail`, `nl`, `rm` and the commands built on the shared file reader print the filesystem's own reason instead of always saying "No such file or directory" (#606). `rm -f` ignores only a file that is not there, no longer every error.
