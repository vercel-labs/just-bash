---
"just-bash": patch
---

Honor `replaceEnv` in the environment returned by `Bash.exec()` for empty scripts, `exit`, and handled errors. These paths no longer restore excluded constructor variables and retain variable changes made during execution.

Restore command-scoped prefix bindings when expansion fails, keeping temporary values out of the returned environment.

Expand command words and arguments before prefix-assignment values, matching Bash. Prefix values no longer affect argument expansion, and a failed argument expansion does not evaluate prefix-assignment values.

Explicit `TEMP=value exit 7` retains `TEMP=value` in `result.env`. This deliberately follows Bash 3.2's EXIT-trap visibility; Bash 5.3 restores the prior binding at top level.
