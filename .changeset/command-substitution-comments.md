---
"just-bash": patch
---

Keep running the script after a `#` inside a word or nested quotes in `$(…)`

A `#` inside a word in a `$(…)` body, as in `$(echo a-#b)`, `$(echo $#)` or `$(echo ${v}#a)`, or inside nested double quotes, as in `$(echo "$(echo "#id")")`, started a comment. The rest of the script became part of one word, so no later command ran and the exit code was 0. A `#` now starts a comment only at the start of a word, as in bash, and a `$(` inside double quotes starts a new quoting context.

A `<<<` here-string inside a multi-line `$(…)` is no longer read as a heredoc.

If the input ends inside `$(`, the script now fails with `` unexpected EOF while looking for matching `)' `` and exit code 2, as in bash. Where the `$(` scan still reads a `#` as a comment that bash does not, as in `` $(echo `echo #a`) `` or `$(echo @(a)#b)`, the script now also fails with this error.

`eval`, `source`, a script file and `compgen -C` now treat a lexer error, such as an unclosed quote, as a syntax error, as they already did for other parse errors. The command fails and the script goes on, as in bash. Before, a lexer error there stopped the whole script and dropped its output.
