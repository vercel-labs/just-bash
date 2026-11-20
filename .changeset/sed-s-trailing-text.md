---
"just-bash": patch
---

sed: reject text after the flags of an `s` command, as GNU sed does

`sed` read any text after the flags of an `s` command as more commands. So a replacement that contained the delimiter by mistake could run `d` or `c` on every line, and `sed -i` could empty the file with exit code 0. Now the closing delimiter is required, blanks may separate the flags, and only `;`, a newline, `}`, `#` or the end of the script may follow them. Other text, a second `g` or `p`, a second number and a zero number are errors with the GNU sed messages. just-bash does not implement the `w`, `e`, `m` and `M` flags, so they are errors too.

Lines of a `sed -f` script file now keep their trailing blanks, as an `-e` script does. So `s a b ` and `y a b `, with a blank as the delimiter, work in a script file, and `a`, `i` and `c` text keeps its trailing blanks, as in GNU sed.
