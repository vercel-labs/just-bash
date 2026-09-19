---
"just-bash": patch
---

bash/sh: start nested shells from the exported environment only

`Bash.exec(…, { env, replaceEnv: true })` set its variables for commands run directly, but a nested `sh -c` or `bash -c` never saw them, and still saw the constructor's env instead:

```js
const bash = new Bash({ env: { SECRET: "leak" } });
await bash.exec("sh", {
  args: ["-c", "echo [$MARKER]; printenv SECRET"],
  env: { MARKER: "YES" },
  replaceEnv: true,
}); // was "[]\nleak\n", now "[YES]\n"
```

A nested shell now behaves like a child process. It receives only exported variables, so `FOO=x; sh -c 'echo $FOO'` no longer sees `FOO`, and `export -n` takes effect. It then sets up its own variables the way bash does at startup: `IFS` and `OPTIND` are reset, and `PATH`, `OSTYPE`, `HOSTNAME` and friends get defaults when not exported. None of these is exported to its own children. Variables passed in `Bash.exec`'s `env` count as exported. An `export` inside one `exec()` no longer leaks into later calls on the same instance. A nested shell that did not inherit `OLDPWD` reports `cd: OLDPWD not set` for `cd -` instead of using the parent's previous directory.
