---
"just-bash": patch
---

Replace the custom js-exec QuickJS worker with run, using synchronous host bindings and native module loading while preserving filesystem, tools, process, fetch, output-limit, and cancellation behavior. Keep queue admission inside the JavaScript deadline, restore argv-only `spawnSync` execution and optional tool exposure, make the bridge request ceiling configurable, bound filesystem and module reads before allocation, preserve module-loader and bootstrap diagnostics, and enforce source and combined-output byte limits without allowing `process.exit()` to clear limit failures. Preserve the `ArrayBuffer` filesystem contract, project command results before they cross into the guest, redact runtime stack paths, and forward cancellation to tool hooks.
