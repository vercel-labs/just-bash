---
"just-bash": patch
---

Keep the outputs that come before a `break` in `jq`, as jq does. `[label $l | (1,2), break $l, 3]` now gives `[1,2]`, and `[label $l | range(5) | ., break $l]` gives `[0]`. This also applies to outputs from `if`, `try ... catch`, `as` bindings, `foreach`, `//` and function bodies. Definitions in the style of jq's `first(f)` and `limit(n; f)` now work when you write them with `label` and `break`. A break out of an array still discards the values of that array. A break out of an operand or an object value also drops the values built before it, because this engine does not yet evaluate them lazily.
