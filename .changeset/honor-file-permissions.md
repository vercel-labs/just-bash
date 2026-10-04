---
"just-bash": patch
---

InMemoryFs and OverlayFs now reject reads of files without owner read permission and writes to files without owner write permission with EACCES; shell redirections, cat, tee, cp, source, and bash/sh report "Permission denied". OverlayFs mv now preserves file modes, and sed -i and tar -x replace read-only files like GNU instead of writing through them.
