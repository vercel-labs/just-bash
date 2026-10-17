---
"just-bash": patch
---

tr: `-ds` squeezes SET2 after deleting SET1, and invalid UTF-8 input stays byte-shaped

Combined `-ds` requires both SETs and squeezes SET2 after deleting SET1, including repetitions joined by deletion. Invalid UTF-8 input stays byte-shaped through translation, deletion, and squeezing instead of being re-encoded as text.
