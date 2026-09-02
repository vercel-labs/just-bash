---
"just-bash": minor
---

Add an optional `IFileSystem.openWritable()` interface for output redirections and numeric descriptors. Custom local, remote, and versioned filesystems can now preserve writable open-file-description identity and lifecycle, while existing implementations continue using the `writeFile()` and `appendFile()` fallback.
