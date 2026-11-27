---
"just-bash": patch
---

Make `sort -h` read the size at the start of a key and ignore what follows it, as GNU sort does. Without `-k` the key is the whole line, so `du -h | sort -h` handed it lines like `872M	./dir`, which failed its whole-key pattern and fell back to the bare number: `872M` sorted as 872 and `1.5G` as 1.5, and `sort -rh | head` named the wrong directory as the largest.

Only `k` and the uppercase `K M G T P E` count as suffixes, as in GNU sort, so a key such as `2gb-archive.tar`, `5m ago` or `3g` reads as 2, 5 or 3 rather than being multiplied. A key starting with `+`, such as `+2M`, is nonnumeric and sorts as 0, also as in GNU sort.
