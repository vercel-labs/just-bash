---
"just-bash": patch
---

Redirect to `/dev/null`, `/dev/stdout`, and `/dev/stderr` without touching the filesystem

On an `IFileSystem` without `mkdirSync` and `writeFileSync`, `/dev` is never seeded. On such a filesystem, every redirect to `/dev/null` made `exec()` reject with `ENOENT`. That covered `> /dev/null`, `2> /dev/null`, `&> /dev/null`, `exec > /dev/null`, and `exec 3> /dev/null`. So did `&> /dev/stderr` and `&>> /dev/stdout`. `< /dev/null` failed with "No such file or directory".

```js
const bash = new Bash({ fs: asyncOnlyFs });
await bash.exec("ls /nope > /dev/null 2>&1; echo rc=$?");
// was: rejects with ENOENT: no such file or directory, '/dev'
// now: stdout "rc=2\n"
```

The redirect layer now treats these paths as devices. Output sent to `/dev/null` is discarded, and `< /dev/null` reads as empty input. On the default filesystem, `>> /dev/null` no longer grows a file, so `cat /dev/null` stays empty. The resolved path decides, so `cd /dev; echo x > null` also discards. `set -o noclobber` no longer blocks `> /dev/stdout`.

Commands that open `/dev/null` by path, such as `cat /dev/null` and `test -e /dev/null`, still need the filesystem to provide it.
