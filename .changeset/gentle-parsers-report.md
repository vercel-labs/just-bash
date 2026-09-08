---
"just-bash": minor
---

Export `isBashParseError()` so parser consumers can distinguish expected lexer, parser, and arithmetic failures thrown by `parse()` from unrelated errors without relying on internal modules or error names.
