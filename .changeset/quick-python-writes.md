---
"just-bash": patch
---

Grow Python HOSTFS file buffers geometrically to avoid copying the entire file
on every extending write. Track logical length separately so reads, append,
end-relative seeks, and close exclude spare capacity. Keep allocations within
the existing file-size limit, and avoid extending files on zero-byte writes.
