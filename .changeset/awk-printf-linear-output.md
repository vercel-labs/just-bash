---
"just-bash": patch
---

Run awk `printf` in linear time. Every `printf` measured the UTF-8 size of everything awk had written so far to learn how much room was left, so `awk '{ printf "%s\n", $0 }'` over 40,000 records took 42 seconds where `print` took 0.15. awk now keeps that size as it writes, and the bound it enforces is unchanged.
