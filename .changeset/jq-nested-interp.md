---
"just-bash": patch
---

jq: allow nested double-quoted strings inside `"\(...)"` string interpolation

jq string interpolation of the form `"\(...)"` that contained a nested double-quoted string — for example `"\(sub("T.*";""))"` or `"\(ltrimstr("ab"))"` — previously failed with a parse error. The tokenizer terminated the outer string at the first `"` it saw inside the interpolation expression, so the rest of the expression became orphaned tokens.

The lexer now tracks `\(...)` depth while consuming a string literal and treats nested `"..."` pairs as opaque content while inside an interpolation, restoring them verbatim into the captured interpolation source. `parseStringInterpolation` similarly skips over nested strings when balancing parentheses, so the interpolation expression is captured as a whole and handed to the expression parser intact.
