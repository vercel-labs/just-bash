---
"just-bash": patch
---

Feed piped stdin to `if`, `for`, C-style `for` and `case` compounds. A pipeline stage such as `echo hi | if :; then cat; fi` or `printf 'a\nb\n' | for i in 1 2; do read x; done` gave the body an empty stdin, so autoconf's `config.status` wrote empty output files. These compounds now read the pipe the way `while`, `until`, groups and subshells already did, and a compound function body reads the stdin of a piped or redirected call.
