---
"just-bash": patch
---

Build `ls` output in linear time. Every line `ls` wrote was appended by re-measuring everything written so far, so `ls -l` on one 20,000-entry directory took two minutes, `ls -d` over a 20,000-name glob took 45 seconds, and `ls -R` paid the same cost again at every level of the descent. Output now goes into one `BoundedStringBuilder` per stream, charged against `maxOutputSize` as it grows, so the same bound holds and `ls -l` on that directory takes a third of a second.
