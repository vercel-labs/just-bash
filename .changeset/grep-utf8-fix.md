---
"just-bash": patch
---

Fix grep UTF-8 input decoding by applying `decodeBinaryToUtf8IfNeeded` at stdin and file-content input boundaries before pattern matching.
