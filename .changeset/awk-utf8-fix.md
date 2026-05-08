---
"just-bash": patch
---

Fix awk UTF-8 handling by decoding latin1-style binary strings from stdin and file reads before line splitting and getline processing.
