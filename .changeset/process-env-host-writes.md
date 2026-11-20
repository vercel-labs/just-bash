---
"just-bash": patch
---

Let host code assign an existing `process.env` key while a script runs, outside the sandbox or inside `runTrusted`, as it already could for `DEBUG`. The assignment threw Node's "'process.env' only accepts a configurable, writable, and enumerable data descriptor", so a library that sets its own variable failed whenever an `exec()` was in flight. Writes from sandboxed code are still blocked, and in audit mode they are recorded as violations.
