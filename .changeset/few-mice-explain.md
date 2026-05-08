---
"just-bash": patch
---

jq: preserve UTF-8 multibyte text when applying nested path assignment filters.
This prevents mojibake caused by treating JSON file bytes as Latin-1 before serialization.
