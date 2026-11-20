---
"just-bash": patch
---

Fix `ReadWriteFs` roots that stayed locked for the life of the process when an execution writing into them finished first, was aborted, or hit its time limit, including an aborted `rm -rf` or file overwrite in a single sandbox. Each mutation now runs in a sandboxed execution of its own that lasts until it settles, so the promise hand-offs inside Node's own `fs` calls settle and release the root. A mutation still waiting in the queue when its execution ends is dropped without settling its caller's promise. Violations in a mutation report the originating execution ID. Arguments are checked and copied before a mutation queues, and an argument of another type now throws a `TypeError`: paths must be strings, encodings strings or `null`, content a string or a `Uint8Array`, `recursive`, `force` and `directory` booleans, modes numbers, and times `Date`s.
