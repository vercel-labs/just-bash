---
"just-bash": patch
---

Nested `sh` and `bash` enable supported options listed in exported `SHELLOPTS` and `BASHOPTS`, such as `pipefail`, `nounset`, and `nullglob`. Child shells initialize their own option state so unexported shopt settings and child option changes no longer leak across that boundary.

Recursive command wrappers copy the active caller's option state without emitting xtrace or verbose output for their synthetic dispatch. Custom commands that execute shell scripts through `ctx.exec()` retain normal tracing. Alias definitions use shell-local storage, so `BASH_ALIAS_*` environment values remain data even when alias expansion is enabled.

Executable script files start without parent aliases and use the same exported-option initialization as nested shells. Imported POSIX mode enables alias expansion. Shopt changes stay within each host execution. Command-context maps exposed through callbacks are revoked when the command completes, just like directly retained maps.
