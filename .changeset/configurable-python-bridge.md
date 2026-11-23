---
"just-bash": minor
---

Add executionLimits.maxPythonBridgeBytes to configure the Python synchronous filesystem and HTTP bridge capacity. Keep the existing 8 MiB default and maxStringLength file guard, and reject oversized writes before buffering data that cannot cross the bridge. Correct the Emscripten EFBIG error number so oversized writes fail instead of being retried as interrupted writes.
