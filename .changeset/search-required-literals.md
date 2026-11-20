---
"just-bash": patch
---

rg and grep: skip text that lacks the pattern's required literals before RE2 runs

Searches derive the literals every match must contain from any pattern, not only plain alternations: `product.*update` requires both `product` and `update`, `ab+c` requires `ab` and `bc`, and `foo(bar|baz)` requires `foo` with `bar` or `baz`. A file without them is not split into lines, and a line without them never reaches RE2. `rg` now uses this filter too; before, only `grep` did.

Case-insensitive filtering folds `ſ` (U+017F) to `s` as RE2 does, so `grep -i sap` keeps a line with `ſap` that the previous filter dropped.
