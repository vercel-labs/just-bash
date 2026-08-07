---
"just-bash": patch
---

Bound real filesystem directory enumeration before retaining oversized listings.
`ls` now applies the existing traversal-entry and output-byte limits while
reading directories lazily with `opendir`.
