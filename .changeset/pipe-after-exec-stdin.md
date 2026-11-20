---
"just-bash": patch
---

A pipeline stage after the first now reads the previous stage's output even when fd 0 was redirected earlier with `exec < file` or `exec </dev/null`. Before, the persistent descriptor replaced the pipe, so `exec </dev/null; printf hi | cat` printed nothing and every `$(... | sed ...)` in an autoconf `configure` came back empty.
