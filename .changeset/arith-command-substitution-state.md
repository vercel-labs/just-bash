---
"just-bash": patch
---

Run a command substitution nested inside `$(( ))`, `(( ))` or an array subscript against the current shell state instead of a detached shell seeded from the initial environment. `X=abc; echo $(( $(echo "$X" | wc -c) ))` returned `1` (GNU bash: `4`) because `$X` was unset inside the substitution — exported variables, functions, the working directory and `local`s were all invisible too. The substitution's output is now spliced into the expression and parsed as arithmetic the way bash does, so `$(( $(echo "1 + 2") ))` is `3` and unparsable output raises an arithmetic syntax error rather than silently evaluating to `0`.
