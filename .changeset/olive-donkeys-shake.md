---
"just-bash": patch
---

Interleave stdout and stderr in write order when a duplication operator sends both to one place, so `{ echo a; echo b 1>&2; echo c; } 2>&1` is `a b c` rather than `a c b`. The order survives nested groups, subshells, functions, loops, `if`/`case`, and scopes left early by `break`, `exit` or `return`, and carries through `|&`, including from a stage that leaves on `exit` or errexit. An fd number reopened within one redirection list names two opens in turn, and a dup lands on the open its source held when it ran, so `1>&3 3>b 2>&3` writes stdout to the first file and stderr to the second rather than both to the first. Each piece is written with the encoding of the stream it came from, so a byte-shaped stdout merged with a Unicode stderr reaches one file as UTF-8 instead of one of the two being re-encoded.
