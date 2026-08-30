---
"just-bash": patch
---

Run lazy file providers in the defense-in-depth trusted scope during materialization. Host-supplied providers doing real async I/O (`setTimeout`, `fetch`, `process.env`) previously tripped the blocked-globals traps when a script first read the file mid-exec, surfacing as a `SecurityViolationError` (formerly a silent empty read / ENOENT). Fixes #253.
