---
"just-bash": patch
---

Fix a denial of service in `html-to-markdown`: a few hundred kilobytes of HTML with a long whitespace run (for example inside `<pre>`) or inline code starting with `<br>` could block the event loop for minutes in Turndown's regexps. Turndown is updated to 7.2.5 and bundled with the linear-time fix from mixmark-io/turndown#543. `@mixmark-io/domino` is now a direct dependency in place of `turndown`.
