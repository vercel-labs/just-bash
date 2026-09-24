---
"just-bash": patch
---

Stop `find` leaving unhandled rejections behind when it fails part way through a batch. `find` reads up to 500 directories at once and failed on the first error, leaving the rest still reading; on a filesystem whose reads take real time, each of them settled after the command had returned, and the defense-in-depth box re-raised its error as an unhandled rejection, which ends a Node process that has no handler. A traversal limit over a large directory tree on disk was enough, and so was an abort or the execution deadline landing mid-batch. `find` now waits for the whole batch before it returns, whichever of the three ends it.
