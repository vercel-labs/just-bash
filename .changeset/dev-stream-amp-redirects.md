---
"just-bash": patch
---

Route `&>` and `&>>` redirects to `/dev/stdout` and `/dev/stderr` to the stream

`cmd &> /dev/stdout` and `cmd &> /dev/stderr`, and their `&>>` forms, wrote both streams to a regular file at that path, so the output vanished. On a filesystem without `/dev` the write failed and `bash.exec()` rejected. Both streams now go to fd 1's or fd 2's current target, like `> /dev/stdout` already did. Output redirect targets are now matched by resolved path, so `/dev/./stdout` and `stdout` from inside `/dev` work too, and `set -C` no longer refuses `> /dev/stdout` on the default filesystem.
