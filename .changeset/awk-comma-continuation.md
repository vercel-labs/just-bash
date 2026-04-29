---
"just-bash": patch
---

Fix awk lexer to honor POSIX statement continuation across newlines after `,`,
`{`, `&&`, `||`, `?`, `:`, `do`, `else`, `if`, and `while`. Previously, a
multi-line idiom like `printf "%s=%d\n", \n  $1, $2` (comma at end-of-line
followed by indented args on the next line) failed with `Unexpected token:
NEWLINE` because the lexer emitted a NEWLINE token unconditionally. The
lexer now suppresses the NEWLINE when it immediately follows one of the
continuation-allowing tokens, matching POSIX awk.
