---
"just-bash": patch
---

Report a missing or non-directory parent of an output redirect target the way bash does

On a filesystem whose `writeFile` throws `ENOENT` for a missing parent directory, `echo x > /missing/f` rejected the whole `bash.exec()` call. Inside a loop, the loop stopped after its first iteration and the script still exited 0. The command now fails alone with `bash: /missing/f: No such file or directory` (or `Not a directory`), `$?` is 1, and the script continues. Numeric-fd redirects such as `exec 3> /missing/f` print the same message in place of `cannot open redirect target`. Other filesystem errors, such as `EROFS`, behave as before.
