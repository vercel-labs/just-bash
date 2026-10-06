---
"just-bash": patch
---

Fix adjacent double-quoted segments such as `"$x""_y"` being merged into one, so that the text of the second segment joined a variable name at the end of the first (`$x_y`).
