---
"just-bash": patch
---

find: report a directory it cannot read and keep going

A `readdir` failure inside the traversal threw out of the whole search, so one unreadable directory ended `find` with no results: exit 1 and `find: EACCES: permission denied, scandir '<path>'` on its own, and exit 0 with nothing at all once piped through `head` with stderr silenced. Every macOS home directory holds such a directory (`.Trash`, several under `Library`), so a recursive `find` over a mounted home directory never returned anything.

GNU find names the directory on stderr, continues with everything else, and exits 1 at the end. It now does the same here. The message is `find: <path>: Permission denied`, with the phrase taken from the errno alone, so nothing from the underlying error's text reaches the output. A failure that is not one of the errnos a directory read can produce (a cancellation, an execution limit, a filesystem policy refusal) still ends the search as before.

Messages are emitted in traversal order beside the node's own output, whatever order the parallel batch settled in, and a failed read still counts toward the trace's `readdirCalls` and `readdirTime`.
