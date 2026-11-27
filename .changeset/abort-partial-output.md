---
"just-bash": patch
---

Keep the output a script printed before an aborted `exec()`. An abort inside a loop, an `if`, a `case`, a statement list, a group or a subshell returned empty stdout and stderr, and loops reported the abort as a plain error. The partial result now carries everything printed up to the abort.
