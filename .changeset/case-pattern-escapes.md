---
"just-bash": patch
---

Fix `case` patterns treating a backslash-escaped or quoted glob character such as `\?`, `\*` or `"*"` as a wildcard, and an escaped backslash (`\\`) in `case` and `[[ == ]]` patterns as an escape of the next character.
