---
"just-bash": patch
---

Make `sort -h` read the size at the start of a key and ignore what follows it, as GNU sort does. Without `-k` the key is the whole line, so `du -h | sort -h` handed it lines like `872M	./dir`, which failed its whole-key pattern and fell back to the bare number: `872M` sorted as 872 and `1.5G` as 1.5, and `sort -rh | head` named the wrong directory as the largest.
