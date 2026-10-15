---
"just-bash": patch
---

Fix `awk` field-splitting bugs:

- An empty `FS` (`FS = ""`) and `split(s, a, //)` no longer crash with `start index out of bounds`. An empty `FS` now splits a record into characters, and keeps characters outside the Basic Multilingual Plane, such as emoji, whole.
- A single-character `FS` such as `-F'|'` or `-F.` is now a literal separator, as in POSIX awk, instead of a regex.
- A record with more fields than `maxArrayElements`, or a `split()` with more parts, now fails with a limit error even at the default limit, instead of being silently truncated at the regex result cap. `split()` also works again when `maxArrayElements` is unlimited; before, it returned 0.
