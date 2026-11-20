---
"just-bash": patch
---

Fix `python3` and `sqlite3` when the embedding process runs under `node --watch`: Node relays each module the worker thread imports as a `watch:import`/`watch:require` message, which was mistaken for a malformed worker response and failed the command (`python3` waited out the full execution timeout and reported exit code 124; `sqlite3` failed immediately). Those messages are now ignored, and a failed `python3` run releases its bridge instead of waiting for the deadline.
