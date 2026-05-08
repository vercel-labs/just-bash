---
"just-bash": patch
---

Fix html-to-markdown UTF-8 mojibake by decoding binary-string stdin/file inputs as UTF-8 before Turndown conversion.
