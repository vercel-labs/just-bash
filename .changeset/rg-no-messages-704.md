---
"just-bash": patch
---

Support ripgrep's `--no-messages` and `--messages` options in `rg`. Both were previously rejected as unrecognized options, which made otherwise valid searches fail (a piped `wc -l` counted 0). `--no-messages` suppresses file traversal and read diagnostics while keeping matches, the original exit status (errors still exit 2), and argument errors such as invalid regexes; `--messages` restores the default behavior, and the last of the two flags wins.
