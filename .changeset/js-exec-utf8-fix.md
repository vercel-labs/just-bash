---
"just-bash": patch
---

Preserve UTF-8 bytes when forwarding `js-exec` stdin source code by decoding latin1-style binary strings before passing code to the QuickJS worker.
