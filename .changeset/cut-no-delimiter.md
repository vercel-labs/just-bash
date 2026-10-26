---
"just-bash": patch
---

`cut -f` now prints a line that contains no delimiter unchanged, as GNU `cut` does, instead of an empty line when the field list does not include field 1. `-s` still suppresses such lines.
