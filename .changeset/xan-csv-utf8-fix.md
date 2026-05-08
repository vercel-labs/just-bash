---
"just-bash": patch
---

Fix xan CSV input decoding to preserve UTF-8 text from stdin and file reads, preventing mojibake for multibyte characters.
