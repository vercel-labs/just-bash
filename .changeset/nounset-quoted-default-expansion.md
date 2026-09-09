---
"just-bash": patch
---

Fix `set -u` reporting "unbound variable" for `"${var:-default}"` and friends when the expansion is the entire double-quoted word.

`echo "${U:-d}"` aborted the script while `echo "${U:-d}b"` and `echo "a${U:-d}"` were fine, because a word that is exactly one double-quoted part holding exactly one `${var<op>word}` is routed through `handleArrayDefaultValue()`, which read the variable with nounset still armed. Every operator that is supposed to suppress nounset was affected: `:-`, `-`, `:=`, `=`, `:+` and `+`.

This broke the idiomatic guard for scripts that run both inside and outside CI:

```bash
set -euo pipefail
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then render >> "$GITHUB_STEP_SUMMARY"; fi
```

`"${#var}"` and a bare `"${var}"` still report an unbound variable under `set -u`, as in GNU bash.
