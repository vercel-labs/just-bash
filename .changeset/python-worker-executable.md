---
"just-bash": patch
---

Use a virtual executable name for CPython instead of the host worker path, avoiding script finalization failures under long installation paths without weakening worker protections.
