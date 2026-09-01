---
"just-bash": patch
---

Fix arithmetic command substitutions in array subscripts, parameter slices, and other parser-derived arithmetic contexts. Command substitution results now preserve Bash arithmetic precedence without re-evaluating generated shell syntax.
