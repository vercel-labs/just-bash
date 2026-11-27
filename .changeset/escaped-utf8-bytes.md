---
"just-bash": patch
---

Decode byte escapes that spell UTF-8 as one character in `printf`, `echo -e`, `$'...'` and `find -printf`

Each octal escape became its own character, so `printf '\303\251'` wrote the four bytes of `Ã©` instead of the two bytes of `é`. The same happened for `%b`, for `echo -e` with octal or hex escapes, and for octal in `$'...'`. A run of byte escapes, octal or hex, is now decoded as UTF-8 together, as `printf '\xc3\xa9'` already was. `printf '\xa'` now reads a one-digit hex escape, `$'\x4g'` keeps the `g`, `\x` before a sign or space stays literal, and a `%` written as an escape (`printf '\045s'`) is printed rather than read as a directive, as in bash.
