---
"just-bash": major
---

Add the `realpath` command for resolving canonical virtual filesystem paths.

Custom `IFileSystem` implementations must support both `realpath(path)` and
`realpath({ path, cwd, mode, signal })`. Both default to strict resolution;
`mode: "all-but-last"` enables GNU `realpath` behavior.
