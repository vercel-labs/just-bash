---
"just-bash": patch
---

Keep shared write offsets for ordinary file redirects and their descriptor copies. Output is delivered after each command, so writes through numeric descriptors are no longer lost or reordered by a redirected group. Truncate files only when opening `>` redirects, preserve unwritten bytes for independent opens, and retain offsets across commands using `exec` redirects. Append redirects write at the current end of the file.

Output redirects to `/dev/stdout` and `/dev/stderr` reopen file destinations with independent offsets and the requested truncation, append, and noclobber behavior, matching Linux. Live stream destinations are captured before later redirects. Command substitutions and input process substitutions capture stdout separately from an enclosing file redirect, while other descriptor copies retain their file destination. Read-write descriptors use byte offsets and preserve untouched UTF-8 and binary bytes.
