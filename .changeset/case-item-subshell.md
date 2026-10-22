---
"just-bash": patch
---

Fix a subshell whose first word is an expansion, such as `( $cmd args )`, being a syntax error in the body of a `case` item.
