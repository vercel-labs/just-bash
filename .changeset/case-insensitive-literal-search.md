---
"just-bash": patch
---

regex: search case-insensitive literals without stepping re2js through every character

re2js only skips ahead to candidate matches when a pattern starts with a
case-sensitive literal, so a case-insensitive search ran its NFA over every
input character. On the 10 MB file from #435 (51 records, each containing the
needle), `grep -ci needle`, `rg -ci needle` and jq `test("needle"; "i")` took
about 3 s, against about 60 ms for the case-sensitive search. When the pattern
is a printable ASCII literal of up to 1,024 characters, `UserRegex` now finds
it with a native case-insensitive `RegExp`, which cannot backtrack on a
literal and matches the same text. Inputs that contain U+212A KELVIN SIGN or
U+017F LATIN SMALL LETTER LONG S still go through RE2 when the literal
contains "k" or "s", because RE2 folds those to ASCII letters. Other patterns
are unchanged.
