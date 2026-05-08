---
"just-bash": patch
---

fix yq UTF-8 mojibake by decoding binary stdin/file input before YAML parsing.
