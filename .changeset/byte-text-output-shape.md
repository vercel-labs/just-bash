---
"just-bash": patch
---

interpreter: fix UTF-8 mojibake when a script interleaves text-output and byte-output statements

A single `exec()` can interleave text-shaped statements (sed, awk, echo — `ö`
as `U+00F6`) with byte-shaped ones (grep | head, cat — `ö` as bytes
`0xC3 0xB6`). `executeScript` / `executeStatement` concatenated each result's
raw stdout, so the lone high byte from the text half made the combined stream
invalid UTF-8, the output-boundary decoder bailed, and the byte half came back
as Latin-1 mojibake (`KÃ¶penicker` for `Köpenicker`). The same path backs
command substitution, so `echo "你好: $(cat /file)"` was affected too.

The fix decodes each statement/pipeline result to text via its explicit
`stdoutKind` (`decodedTextFromResult`) before concatenating — no guessing from
string contents, so text whose code units merely look like UTF-8 (`Ã¶`) is
preserved. `tac` (stdin path) and `curl` (response body) now declare
`stdoutKind: "bytes"` on the results that forward raw bytes, so the decode is
driven per output rather than by inspecting characters.
