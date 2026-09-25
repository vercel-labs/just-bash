---
"just-bash": patch
---

Convert byte buffers in bounded chunks instead of concatenating a character per byte. Large files read through custom filesystem adapters could otherwise exhaust the JavaScript heap before commands such as head returned their small requested output. UTF-8 pipeline encoding uses the same conversion path.
