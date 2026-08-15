---
"just-bash": patch
---

Order `ls -R` sections by the active sort key, so `-t` and `-S` reach the descent rather than only each directory's own listing, and charge the traversal budget while resolving operands rather than only once the walk has started. Each operand costs one entry rather than two, `-d` charges its operands instead of returning before the budget sees them, and the metadata reads `-t` and `-S` need to sort are charged before they run.
