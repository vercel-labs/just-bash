---
"just-bash": patch
---

Apply the number of a `sed` `s` command together with `g`, as GNU does: `s/a/b/2g` replaces the second match and every later match, instead of every match. With a number, the `p` flag and the `t` and `T` commands now see a substitution only when a match is replaced, not when the pattern matches fewer times than the number. The number also counts matches as `g` does, so an empty match right after another match does not count: `s/b*/x/3` on `abc` now gives `abcx`. `T` also clears the flag when it does not branch, as GNU does, so a later `T` sees only the substitutions after it.
