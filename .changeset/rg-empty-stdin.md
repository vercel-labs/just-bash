---
"just-bash": patch
---

rg: search an empty piped or redirected stdin instead of the current directory

`printf '' | rg target` treated the empty pipe as absent stdin and recursively searched the current directory. Real ripgrep searches the empty input and exits 1 with no matches. A pipeline stage or an fd-0 redirection (`< empty-file`, an empty here-doc) now counts as stdin even when empty, including through `command rg` and `exec rg`.

This applies to every external command: inside a group with its own stdin, `{ cat < empty-file; } < other` now reads EOF instead of falling back to `other`.

An input redirection on another descriptor (`2< file`, `2<<< word`) no longer replaces stdin, so commands read their real stdin instead of that descriptor's content.
