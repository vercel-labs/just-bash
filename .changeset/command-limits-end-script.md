---
"just-bash": patch
---

Propagate execution limits from `awk`, `sed`, `jq`, and `yq` so a pipeline or `||` cannot hide them. Discard unaccounted AWK output when a limit is reached.
