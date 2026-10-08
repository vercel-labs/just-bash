---
"just-bash": patch
---

Evaluate the index of `X[expr]` in `jq` against the input, as jq does, so `.foo[.bar]` and `$m[.]` look up the right key. The index is read before the base and several keys come out in jq's order. `path()` and `del` follow the same rule, and `xan` can index with a column, as in `split(names, '|')[idx]`. Filters that leaned on the old reading change too: `.items[length-1]` now reads `length` from the input, so use `.items[-1]` for the last item.
