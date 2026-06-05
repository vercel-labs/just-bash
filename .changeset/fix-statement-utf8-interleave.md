---
"just-bash": patch
---

interpreter: fix mojibake when a script interleaves text-output and byte-output statements

When a single `exec()` call ran multiple statements that produced different output "shapes" — e.g. `sed` (text-shaped: `ö` as U+00F6) followed by `grep | head` (byte-shaped: `ö` as bytes 0xC3 0xB6) — the non-ASCII text in the byte-shaped portion came out as mojibake (`KÃ¶penicker` instead of `Köpenicker`).

The root cause: `executeScript` concatenated each statement's raw stdout string before the single UTF-8 decode at the `exec()` output boundary. The text-shaped half contributed a bare `0xF6` byte (not valid UTF-8 on its own), making the combined byte stream invalid, so the boundary decoder fell back to returning the raw string. The byte-shaped half then never got decoded.

The fix decodes each statement's stdout to UTF-8 text in isolation, before concatenating. The decoder is a no-op on already-decoded text (chars > 0xFF short-circuit it), so the existing boundary decode in `Bash.ts` stays idempotent and nothing else changes.

The same `executeScript` path is called for command substitution bodies (`$(cat /file)`), so this also fixes the analogous case where a byte producer inside `$(...)` produced mojibake when its output was spliced into an outer string (e.g. `echo "你好: $(cat /file)"`).
