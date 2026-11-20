---
"just-bash": patch
---

`exec()` no longer re-decodes the returned `stdout`, which the interpreter has already decoded. Text consisting only of Latin-1 range characters that happens to spell valid UTF-8 (e.g. `Ã©`) is returned unchanged instead of being silently rewritten to different characters (`é`). Byte-shaped command output continues to be decoded once by the interpreter using its known output shape. `stderr` still goes through the output-boundary decode, because byte-shaped output redirected to it carries no shape metadata.
