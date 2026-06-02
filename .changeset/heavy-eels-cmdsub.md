---
"just-bash": patch
---

parser: don't treat quotes inside a heredoc body as shell quotes when finding the end of a command substitution

A command substitution whose body contained a heredoc with an unbalanced quote in its body — most commonly an apostrophe in literal prose, e.g. `June's` — failed to parse with `bash: syntax error: ... unexpected EOF while looking for matching ')'`:

```bash
OUT=$(cat <<'SCRIPT'
June's moon
SCRIPT
)
```

Both the lexer's `$(...)` word scanner and the substitution boundary scanner walked into the heredoc body and applied shell quote tracking to it. The `'` in `June's` opened a single-quoted string that never closed, so the closing `)` was swallowed and the scan ran to EOF. In bash a heredoc body is literal text and must be skipped wholesale when locating the substitution boundary.

Both scanners are now heredoc-aware: when scanning a `$(...)` they recognize `<<` / `<<-` operators (but not the `<<<` here-string), capture the possibly-quoted delimiter, and skip the heredoc body lines literally — without quote or paren tracking — up to the terminator. Multiple heredocs on one line and tab-stripping (`<<-`) are handled. This fixes the common pattern of capturing the output of a connector/CLI invocation that is fed a heredoc script containing apostrophes, backticks, or parentheses.
