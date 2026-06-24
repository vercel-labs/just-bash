---
"just-bash": patch
---

interpreter: preserve leading whitespace in multi-line quoted strings (fixes #259)

`exec()` runs each script through `normalizeScript()`, which `trimStart()`s
leading indentation from lines so indented template-literal scripts parse. It
was applied line-by-line and stripped the leading whitespace inside multi-line
single- and double-quoted strings too. The visible symptom was `python3 -c
'...'` (and `node -e`, `awk`, etc.) with an indented body failing with
`IndentationError`, while the same code via heredoc or pipe worked.

`normalizeScript()` is now quote-aware (mirroring the earlier heredoc-aware
fix): it only strips indentation from lines that begin outside any quote, and
preserves lines that begin inside an unterminated single- or double-quoted
string verbatim. This also un-skips four sed spec tests whose indented stdin
was previously being corrupted.
