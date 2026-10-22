---
"just-bash": patch
---

End the script when `awk`, `sed`, `jq`, or `yq` hits an execution limit, as every other command already does, instead of returning exit 126 that a pipeline or `||` could hide.
