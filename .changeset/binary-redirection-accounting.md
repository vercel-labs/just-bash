---
"just-bash": patch
---

Preserve non-ASCII stdout when a command also emits stderr and stderr is redirected away, instead of failing with invalid stdout accounting.
