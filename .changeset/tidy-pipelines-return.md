---
"just-bash": patch
---

Restore the working directory as well as PWD after pipeline stages that run in subshell contexts, so cd cannot redirect later stages or subsequent relative file operations. Preserve current-shell behavior for single commands and the final stage with lastpipe enabled.
