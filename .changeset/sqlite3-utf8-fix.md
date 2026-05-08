---
"just-bash": patch
---

Fix sqlite3 stdin SQL decoding to preserve UTF-8 string literals when input arrives as a latin1-style binary string.
