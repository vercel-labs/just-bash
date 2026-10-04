---
"just-bash": patch
---

InMemoryFs and OverlayFs now reject reads of files without owner read permission and writes to files without owner write permission with EACCES; shell redirections, cat, tee, source, and bash/sh report "Permission denied".
