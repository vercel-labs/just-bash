---
"just-bash": minor
---

Add the `commandNotFound` option to run commands that just-bash does not provide.

The command runs for each name that is neither a builtin nor a function and is not found in PATH, and receives the missing name followed by its arguments, similar to bash's `command_not_found_handle`. Nested executions such as `bash -c`, `xargs` and `timeout` use it too.

Commands the shell registers never reach `commandNotFound`, even when a script changes `PATH` or deletes their stubs in `/bin` and `/usr/bin`; they fail with "command not found" (127) instead.

A name that PATH contains only as a file without execute permission now fails with "Permission denied" (exit status 126), as in bash, instead of "command not found" (127), and does not reach `commandNotFound`. The error names the file as formed from the PATH entry, and `hash -t` reports it afterwards. Stubs that another `Bash` instance wrote for commands this one does not register count as absent, so on a shared filesystem those names still fail with 127 or reach `commandNotFound`.

`command -v` and `command -V` now find executable scripts in PATH, and `hash` no longer remembers files without execute permission.
