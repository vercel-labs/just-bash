---
"just-bash": patch
---

Add `redirectCreatesDirectories` to `BashOptions`. Set false, a redirect into a directory that does not exist fails with `No such file or directory` (or `Not a directory`), as in bash, instead of making the directory. The default keeps today's behavior.
