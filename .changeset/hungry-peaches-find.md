---
"just-bash": patch
---

Support `rg --color` and `--`, and align heading layout, context match prefixes, glob precedence, explicit-file selection, zero match limits, and error exit codes with ripgrep. Preserve the documented smart-case default and plain text output for all color choices.

Correct overlapping-context match prefixes in `grep`, `egrep`, and `fgrep`, while retaining context prefixes for trailing lines after their `-m` limit. Apply ripgrep's combined `--glob`/`--iglob` precedence, validate types in `rg --files` mode and malformed `--iglob` values, and accept attached values in combined short flags and leading `+` in nonnegative numeric values.

Honor per-file `-m` limits in line-based count mode for `rg`, `grep`, `egrep`, and `fgrep`, including `rg --count-matches`, which counts every occurrence on the selected matching lines.
