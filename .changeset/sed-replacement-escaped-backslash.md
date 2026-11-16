---
"just-bash": patch
---

`\\` in a `sed` replacement is now one literal backslash, as in GNU sed, also when a backreference or `&` follows it. `s/\(x\)/\\\1/` turns `x` into `\x` instead of `\1`, and the autoconf `config.status` quoting `` s/\(["`$\\]\)/\\\1/g `` doesn't turn every escaped character into `\1` anymore.
