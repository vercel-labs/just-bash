---
"just-bash": patch
---

Group `ls` operands the way GNU and BSD `ls` do. Non-directory operands now print first as a single unseparated block in sort order, then each directory prints under a `name:` label preceded by a blank line. Previously every operand was separated by a blank line, including plain files, so `find … -exec ls -l {} +` and `xargs ls -l` returned a listing with an empty line between each entry.
