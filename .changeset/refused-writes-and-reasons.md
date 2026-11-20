---
"just-bash": patch
---

A refused write fails the command, not `exec()`, and commands say why a file operation failed

A redirect whose target the filesystem refuses (`EROFS`, `EACCES`, `EPERM`, `EISDIR`, `ENAMETOOLONG`, `EINVAL`, `ENOSPC`, and the like), at open or when the content is delivered, used to reject the whole `bash.exec()` call or, inside a loop, end the loop. It now fails alone with `bash: /ro/f.txt: Read-only file system`, `$?` is 1, and the script continues (#603). An error that names none of these errnos still propagates. `<` and `<>` name the reason too, and `tee`, `sed` (including `-i`), `cat`, `head`, `tail`, `nl`, `rm` and the commands built on the shared file reader print the filesystem's own reason instead of always saying "No such file or directory" (#606). `rm -f` ignores only a file that is not there, no longer every error.

`<>` creates the file only when it does not exist and refuses an existing one it cannot write; a failed read never truncates it. A content-write diagnostic follows the fd 2 redirection (`2>/dev/null`, `2> errors`) and names the path as typed. `rm -f` ignores `ENOENT` and `ENOTDIR` only, reports any other errno and rethrows an error outside the errno map. `EFBIG` is mapped, `nl` goes on to later files after an input error, and the sandbox's own refusals (`SandboxBoundaryError`: outside the root, symlinks, special files) are never turned into a diagnostic.
