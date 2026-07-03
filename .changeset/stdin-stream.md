---
"just-bash": minor
---

interpreter: model stdin as a single shared stream (`StdinStream`), fixing loops and compound commands losing stdin position

Stdin is now represented exactly one way everywhere: a `StdinStream` object
that behaves like a bash file descriptor — it holds the content bytes and a
read offset, and is shared by reference. Reading is consuming: a command
that drains stdin (`cat`, `grep`, `sed`, ...) advances the offset for every
other holder of the stream, including across subshell and pipeline-stage
boundaries. This replaces the old `groupStdin?: string` snapshot plus
per-call-site fallback rules, which made it easy for a command to read the
loop's stdin without advancing it.

Fixes, all verified against real bash via recorded comparison fixtures:

- Commands inside `while read` loop bodies (pipelines, `cat`, `grep`, `tr`,
  and ~30 other stdin consumers) now advance the loop's stdin instead of
  re-reading the same input each iteration.
- Stdin redirections (`<`, `<<`, `<<-`, `<<<`, `<&`) now work uniformly on
  all compound commands (`if`, `for`, `while`, `until`, `case`, subshells,
  groups) through one shared resolution path.
- Subshells share the stdin offset with their parent (matching bash fd
  semantics): `{ (read x); read y; } < f` gives `y` the second line.
- A pipeline stage that produces empty output no longer lets the next
  command fall back to the enclosing scope's stdin.
- Heredoc/here-string content on compound commands and functions is now
  UTF-8 encoded into the byte pipeline consistently (previously only simple
  commands did this).
- Function definition redirects (`f() { ...; } < file`) now apply on every
  call and win over piped stdin; a missing redirect file is an error and
  the body does not run (both match bash).

BREAKING (TypeScript API): `CommandContext.stdin` is now a `StdinStream`
instead of a `ByteString`. Custom commands call `ctx.stdin.readAll()` to
consume input (or `ctx.stdin.peek()` to inspect without consuming) and
convert with `latin1FromBytes` / `decodeBytesToUtf8` as before. The
`StdinStream` class is exported from the package root.
