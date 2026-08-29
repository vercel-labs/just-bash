---
"just-bash": patch
---

Replace the custom js-exec QuickJS worker with run, using synchronous host bindings and native module loading while preserving filesystem, tools, process, fetch, output-limit, and cancellation behavior.
