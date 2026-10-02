---
"just-bash": patch
---

interpreter: tell a custom command whether fd 0 is connected

A custom command received `ctx.stdin` as bytes and nothing about where they came from, so `false | cmd` and a bare `cmd` arrived identically. A command that reads stdin only when it has one (ripgrep, which walks the directory otherwise) had to guess, and guessing from the byte count turns every failed producer into a directory walk. `ctx.stdinConnected` now says whether a pipe, a redirection, or an enclosing group's stdin is on the other end of fd 0, even when nothing arrived.

Underneath, every pipeline stage after the first now owns its stdin the way a redirection from an empty file does, so the flag also holds for a command inside a group, subshell, function, loop, conditional, executable script, sourced file, `eval`, or nested `bash -c` that a pipe feeds. It is false for a closed fd 0 (`cmd 0<&-`), and stays false inside any of those scopes when the closed descriptor is theirs (`{ cmd; } 0<&-`, `f 0<&-`, `./script 0<&-`), and inside a bare `bash -c`. The same ownership reaches `if`, `for`, and `case` as pipeline stages, and `source`, which previously received no stdin at all: `printf 'a\n' | if true; then read x; fi` and `printf 'a\n' | source file` left `x` empty where bash reads `a`.
