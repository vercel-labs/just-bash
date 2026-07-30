---
"just-bash": minor
---

Add `grep -f FILE` / `--file=FILE` to read patterns from a file (one per line). Patterns from `-f` OR-combine with `-e` patterns and with each other, `-f -` reads patterns from stdin, empty pattern lines match every line, and an empty pattern file selects nothing (exit 1). Newline-separated `PATTERNS` operands are now split into individual patterns, and `-x` groups alternatives correctly (`^(?:a|b)$`).
