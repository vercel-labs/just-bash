---
"just-bash": patch
---

Fix `ReadWriteFs` roots that stayed locked for the life of the process when an execution writing into them finished first, was aborted, or hit its time limit, including an aborted `rm -rf` or file overwrite in a single sandbox. Each mutation now runs in a sandboxed execution of its own that lasts until it settles, so the promise hand-offs inside Node's own `fs` calls always settle and release the root while everything the mutation runs stays restricted, and the queue waits and releases with `await`. A mutation still waiting in the queue when its execution ends is dropped with an `ECANCELED` error instead of running afterwards. Arguments are checked and copied before a mutation queues, and an argument of another type now throws a `TypeError`: paths and encodings must be strings, content a string or a `Uint8Array`, `recursive`, `force` and `directory` booleans, modes numbers, and times `Date`s.
