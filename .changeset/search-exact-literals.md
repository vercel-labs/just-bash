---
"just-bash": patch
---

rg and grep: a line that contains a whole literal alternative of the pattern matches without RE2

When a top-level alternative is a plain literal (`inactive` in `inactive|product.*update`) and the output needs no match position, a line containing it is a match, so RE2 does not scan it. This matters most for long lines, such as minified bundles and source maps, where RE2 ran over megabytes per line. With `-i` the shortcut applies to any line without `İ` (U+0130), the one character whose lowercase form contains an ASCII letter that RE2 does not fold.
