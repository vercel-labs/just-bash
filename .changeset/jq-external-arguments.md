---
"just-bash": minor
---

jq: add external-argument flags (`--arg`, `--argjson`, `--rawfile`, `--slurpfile`, `--args`, `--jsonargs`) and the `$ARGS` object (`$ARGS.named` / `$ARGS.positional`), matching real jq 1.7.1 behavior including exit codes, error messages, and prototype-sensitive key handling.