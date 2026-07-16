---
"just-bash": minor
---

Add curl `-G`/`--get` query-string data handling and preserve command-line order when repeated `-d`, `--data-raw`, `--data-binary`, and `--data-urlencode` options are mixed, including `@file` forms. Data requests now also set curl's standard `application/x-www-form-urlencoded` content type unless the caller supplies one.
