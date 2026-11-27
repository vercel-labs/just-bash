---
"just-bash": patch
---

Parse an awk variable followed by whitespace and parentheses as concatenation. User-defined function calls require an adjacent opening parenthesis; built-in calls still allow whitespace. Reading a user-defined function name as a scalar now reports an error.
