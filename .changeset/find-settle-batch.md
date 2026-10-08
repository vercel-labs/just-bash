---
"just-bash": patch
---

Stop `find` leaving unhandled rejections behind when it fails part way through a batch. `find` reads up to 500 directories at once and failed on the first error through `Promise.all`, leaving the rest still reading; on a filesystem whose reads take real time, each of them settled after the command had returned, and the defense-in-depth box blocked the handler `Promise.all` had attached and re-raised its error as an unhandled rejection, which ends a Node process that has no handler. A traversal limit over a large directory tree on disk was enough, and so was an abort or the execution deadline landing mid-batch. `find` now attaches each read's handler through `await`, which the box does not guard, so a read that fails at any time later is still handled, and it returns on the first failure or as soon as it is cancelled rather than waiting for a read that may never settle.
