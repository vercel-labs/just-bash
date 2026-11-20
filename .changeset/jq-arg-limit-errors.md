---
"just-bash": patch
---

Report a `--argjson`, `--jsonargs` or `--slurpfile` value that exceeds the query depth or element limit as that limit (`jq: query depth limit exceeded (1000)`, exit 126), as jq already does for the same JSON as input, instead of `invalid JSON text passed to …`. The value is valid JSON, and the old message suggested otherwise.
