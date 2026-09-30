---
"just-bash": minor
---

`js-exec`'s `fs` answers the way Node's does. `statSync`/`lstatSync` (and their promise forms) return an `fs.Stats` whose `isFile()`, `isDirectory()`, and `isSymbolicLink()` are methods and whose `mtime` is a `Date` (with `mtimeMs`, `atime`, `ctime`, `birthtime` alongside); before, they were booleans and an ISO string, so `stat.isFile()` threw `not a function`. `readdirSync` honors `{ withFileTypes: true }` (an `fs.Dirent` with `name`, `parentPath`, and the same type methods) and `{ recursive: true }` (every entry below, as `sub/file.txt`); before, both options were ignored. A failed call throws an error carrying `code`, `errno`, `syscall`, `path` (and `dest`), with the path as it was passed in the message. `fs/promises` is a module of its own for `require` and `import`. An uncaught fs error is reported at the script's line rather than at a line inside the runtime's shims, and a guest error carrying a `code` of its own is no longer mistaken for a host failure.

Breaking for code that read `stat.isFile` as a boolean: call it.
