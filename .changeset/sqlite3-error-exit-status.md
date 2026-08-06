---
"just-bash": patch
---

sqlite3: report failed statements on stderr and exit non-zero without `-bail`

A statement that failed was written to **stdout** as `Error: ...` and the command still exited `0` unless `-bail` was passed. Real `sqlite3` writes the error to stderr and exits `1` in either mode; `-bail` only decides whether the remaining statements still run.

Two consequences for callers: `sqlite3 db "SELECT ..." > out.csv` silently wrote the error text into the data file, and `sqlite3 db "..." && next-step` ran `next-step` after the query had failed, so a shell script could not detect a bad query without opting into `-bail` and losing the ability to see later statements.

Errors now accumulate on stderr in statement order and the exit status is `1` whenever any statement failed. Successful runs are unchanged, `-bail` still stops at the first failure, and the partial stdout produced before a failure is still emitted. Writeback of a partially-successful script is also unchanged.
