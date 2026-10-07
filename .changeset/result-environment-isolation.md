---
"just-bash": patch
---

Honor `replaceEnv` in the environment returned by `Bash.exec()` for empty scripts, `exit`, and handled errors. These paths no longer restore excluded constructor variables and retain variable changes made during execution.

Restore command-scoped prefix bindings when expansion fails, keeping temporary values out of the returned environment.

Expand command words and arguments before prefix-assignment values, matching Bash. Prefix values no longer affect argument expansion, and a failed argument expansion does not evaluate prefix-assignment values.
