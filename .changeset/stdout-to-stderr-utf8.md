---
"just-bash": patch
---

Decode UTF-8 command output redirected to stderr with `1>&2`, so it is not returned as mojibake when stderr also contains other non-ASCII text.
