---
"just-bash": patch
---

perf(grep): up to 14.5× speedup via preFilter extensions and matcher reuse.

Anchored alternation patterns like `^def \|^async def` now extract literal needles (stripping outer `^`/`$`), enabling the `String.indexOf` fast-path. Files with no matching needle are rejected before `split("\n")`, skipping RE2 entirely. `acquireMatcher()` extended to `match()`, `replace()`, `search()`, and `matchAll()` to reduce GC pressure across awk/sed hot-paths.