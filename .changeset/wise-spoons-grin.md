---
"just-bash": patch
---

set: support a bundled `-o`/`+o` long option inside a short-flag cluster (e.g. `set -euo pipefail`)

The `set` builtin previously rejected `set -euo pipefail` with `bash: set: -o: invalid option`, because it parsed each character after the `-` as an independent short flag and has no `o` short flag. `-o` was only honored as its own token (`set -eu -o pipefail`).

This is the canonical "bash strict mode" idiom and is extremely common in generated scripts, so the whole script would abort on its first line.

`set` now matches bash: an `o` inside a cluster consumes the *next word* as its long-option name, and the remaining characters keep being parsed as short flags. So `set -euo pipefail` is equivalent to `set -e -u -o pipefail`, `set -oe pipefail` enables both `pipefail` and `errexit`, trailing words become positional parameters, and `+`-clusters (`set +euo pipefail`) disable the options. An invalid bundled name (`set -euo bogus`) still reports `invalid option name`, and an `o` with no following argument falls back to the standalone `-o`/`+o` listing.
