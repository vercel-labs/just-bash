---
"just-bash": minor
---

`js-exec` accepts `-e`/`--eval` as another spelling of `-c` and `-p`/`--print` to print an expression's value, the options `node` takes for inline code. `process.argv` now has Node's shape: the executable first, then the script for a file (nothing for inline code, as with `node -e`), then the arguments, so a file reads its arguments with `process.argv.slice(2)` and inline code with `slice(1)`, as under node.

Breaking for a script that indexes `process.argv` directly: `argv[0]` was the script path and is now `"js-exec"`, and `argv[1]` was the first argument and is now the script path (for inline code, still the first argument). A script written against the old shape keeps running and reads the wrong values, so check any `process.argv[n]` when upgrading.
