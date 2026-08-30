---
"just-bash": patch
---

Bound `ls` directory entry collections before per-entry work. A filesystem backend returning a very large directory could previously drive `ls` into sorting, statting, classifying and formatting every entry before any limit applied, and piping to `head` did not help because pipeline producers are materialized before consumers run. Oversized listings now fail with exit code 126 (`array element limit exceeded` / `filesystem traversal entry limit exceeded`), the recursive descent no longer fans out across sibling directories, and every operand of a multi-directory listing is charged to the same budget.
