---
"just-bash": patch
---

Fix `ReadWriteFs` roots that stayed locked for the life of the process when an execution writing into them finished first, was aborted, or hit its time limit, including an aborted `rm -rf` or file overwrite in a single sandbox. Each mutation now runs outside its caller's defense-in-depth context, so the promise hand-offs inside Node's own `fs` calls always settle and release the root, and the queue waits and releases with `await`. A mutation still waiting in the queue when its execution ends is dropped with an abort error instead of running afterwards. Arguments are copied before a mutation queues, so a path, mode or option field passed as an object, or a time that is not a `Date`, now throws a `TypeError`.
