---
"just-bash": patch
---

Pass `sed -f` script files to the parser whole, so commands can span lines (backslash continuations in `s///` and `a\`/`i\`/`c\` text), a final `a\` appends an empty line, and `#n` on the first line suppresses output. `-e` scripts and `-f` files now run in command-line order.
