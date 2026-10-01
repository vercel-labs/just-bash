---
"just-bash": patch
---

Compile Python user source without indenting it into the worker wrapper. This preserves multiline string contents and generated code, allows module-level future imports, and reports user filenames and original line numbers in tracebacks.
