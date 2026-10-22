---
"just-bash": patch
---

Keep literal text around an array in a default or alternative word. With `arr=(x y)` and `U` unset, `printf '<%s>' "${U:-pre${arr[@]}post}"` printed `<x><y>` and dropped `pre` and `post`. It now prints `<prex><ypost>` as bash does: text before the array joins the first element, text after it joins the last, and `[*]` joins the elements with the first character of `IFS`.
