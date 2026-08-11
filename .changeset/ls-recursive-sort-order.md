---
"just-bash": patch
---

Order `ls -R` sections by the active sort key, so `-t` and `-S` reach the descent rather than only each directory's own listing, and charge the traversal budget while resolving operands rather than only once the walk has started.
