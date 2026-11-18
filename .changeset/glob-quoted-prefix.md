---
"just-bash": patch
---

Glob after a quoted directory (`"$dir"/*`) as bash does: the quoted part is read as a literal path even when it holds spaces, parentheses, or brackets, and a word that matches nothing stays one word instead of splitting at the spaces in its quoted part.
