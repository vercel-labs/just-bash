---
"just-bash": patch
---

Fix jq array removal with `.arr -= ["b"]` and `del(.arr[] | select(. == "b"))`. Like jq, arithmetic assignments such as `+=` now raise an error for unsupported operand types instead of assigning `null`, and `del` raises an error for expressions that are not paths or for containers of the wrong type instead of leaving the input unchanged. A postfix `?`, as in `.a.b?`, now suppresses errors only from its own access, so errors from `.a` are raised. `elif` conditions that produce several results or none now select branches like jq, and dynamic indexes such as `.a[.i]` read `.i` from the input instead of from `.a`.
