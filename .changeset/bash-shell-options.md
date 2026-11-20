---
"just-bash": patch
---

bash/sh: read options as bash does, answer `--version`, and report syntax errors as bash does

`bash` and `sh` took `-c` only as the first argument, so `bash -lc 'echo hi'` failed with `bash: -lc: No such file or directory`. Options are now read as bash reads them: combined letters (`-lc`, `-euo pipefail -c`), `-c` anywhere among the options, `-s`, `--` and `-`; `set`'s letters, `-o NAME` and `-O NAME` apply before the script runs; `-l`, `-i`, `--login`, `--noprofile` and `--norc` are accepted and ignored. `--version` prints `GNU bash, version 5.1.0(1)-release (just-bash)`, matching `$BASH_VERSION`.

A syntax error is reported as bash reports it, naming the script and line and the token bash names:

```js
await bash.exec("printf 'echo ok\\nif then\\n' > t.sh; bash -n t.sh");
// was: bash: syntax error: Parse error at 3:1: syntax error near unexpected token `fi'
// now: t.sh: line 2: syntax error near unexpected token `then'
```

`ExecOptions` and `CommandExecOptions` gain `scriptName`, what a syntax error is reported under (`bash` by default). An empty `if`/`elif`/`while`/`until` condition is now a syntax error at the word that follows it, and a missing `fi`/`done` at the end of the script reads `syntax error: unexpected end of file`.
