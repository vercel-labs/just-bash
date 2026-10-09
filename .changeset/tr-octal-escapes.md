---
"just-bash": patch
---

tr: decode octal escapes and `\\`, `\a`, `\b`, `\f`, `\v` in SETs

`tr` only understood `\n`, `\t` and `\r`, so `\015` was read as `0` and `\101` as `1`. It now decodes `\NNN` (one to three octal digits) and the remaining POSIX escapes, and an escape can be a range endpoint, as in `tr -d '\000-\037'`. Like GNU tr, an octal value above `\177` is a single byte: a SET that has one makes `tr` work on the input's bytes instead of its decoded characters. This fixes autoconf's `config.status`, which computes a carriage return with `tr X '\015'`.

Extra operands are rejected before SET expansion or byte-mode selection, so an invalid trailing SET cannot change how valid SETs process the input.
