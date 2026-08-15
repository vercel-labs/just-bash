---
"just-bash": patch
---

Append type indicators in `ls -l` only when `-F` asks for them. Long format previously suffixed every directory with `/` regardless, so a name read out of `ls -l` output carried a trailing slash that is not part of it, and `ls -l` disagreed with `ls` about what the same entry is called.
