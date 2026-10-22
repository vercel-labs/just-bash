---
"just-bash": patch
---

Each `exec()` now gets its own copy of `shopt` settings, readonly attributes, and hashed command paths, so changes made by one `exec()` no longer carry over to later calls on the same `Bash` instance.
