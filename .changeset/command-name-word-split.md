---
"just-bash": patch
---

bash: split and glob an unquoted command name

`CC="echo cc -O2"; $CC -c x.c` reported `echo cc -O2: command not found`. The command name was expanded as one word. It now gets brace expansion, word splitting and globbing, as an argument does and as in bash. The first field is the command, and the other fields come before the arguments. This also makes `$*`, `"$@"` and `"${a[@]}"` work as a command with its arguments.

A name that expands to no fields, such as `"$@"` with no positional parameters, leaves the first argument as the command. An empty field, such as `''` or a quoted empty `"$x"`, is "command not found" with status 127.
