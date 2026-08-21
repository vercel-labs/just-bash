---
"just-bash": patch
---

curl: don't build the stdout string when the body is written to a file

`curl -o FILE URL` (and `-O`) stringified the entire response body for stdout
and then immediately discarded it, holding a full UTF-16 copy of the payload in
memory alongside the bytes being written. Large downloads could exhaust memory
(a browser-hosted embedder OOM'd its renderer on a 250 MB download). The stdout
string is now skipped entirely on that path; `-v`, `--write-out`, `-I/--head`
and all other behaviour are unchanged.
