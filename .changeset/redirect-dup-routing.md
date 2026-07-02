---
"just-bash": patch
---

interpreter: deliver redirected output to each fd's final target (fixes `cmd > file 2>&1` leaking stderr to stdout)

`applyRedirections()` processed a command's redirection list sequentially over
the result's stdout/stderr strings, moving content at each step. The
duplication operators (`2>&1`, `1>&2`) merged into the live stream regardless
of where the source fd pointed, so the canonical `cmd > file 2>&1` wrote
stdout to the file but leaked stderr onto the caller's stdout — including
"command not found" errors and custom-command stderr. Any wrapper protocol
that parses the enclosing script's stdout (e.g. a runner emitting a JSON
payload after `eval "$CMD" > "$OUT" 2>&1`) saw the leaked stderr corrupt its
stream. Ordering variants were wrong in other ways: `cmd 2>&1 > file` put
stderr in the file instead of on stdout, and `cmd > a > b` wrote content to
`a` instead of `b`.

The pass now mirrors how bash sets up fds before running the command: each
output redirection only opens/truncates its target and re-points the fd's
sink (file, /dev/null, or a snapshot of the caller-visible stream), and
duplication operators copy the source fd's current sink. Stream content is
delivered once, after the whole list is processed, to each fd's final sink.
This makes `cmd > file 2>&1` send stderr to the file, `cmd 2>&1 > file` keep
stderr on the caller's stdout, `cmd > all 2>&1 2> err` let the later `2> err`
reclaim stderr, and `cmd > a > b` truncate `a` while writing content to `b`.
The `/dev/null`-as-regular-VFS-file behavior for stdout redirects is
preserved.
