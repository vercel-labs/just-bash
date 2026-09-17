---
"just-bash": patch
---

Interleave stdout and stderr in write order when a duplication operator sends both to one place, so `{ echo a; echo b 1>&2; echo c; } 2>&1` is `a b c` rather than `a c b`. The order survives nested groups, subshells, functions, loops, `if`/`case`, and scopes left early by `break`, `exit` or `return`, and carries through `|&`. Each piece is written with the encoding of the stream it came from, so a byte-shaped stdout merged with a Unicode stderr reaches one file as UTF-8 instead of one of the two being re-encoded.
