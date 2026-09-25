---
"just-bash": patch
---

Give `MountableFs` synchronous `mkdirSync` and `writeFileSync`, routed to the filesystem that owns the path, so `Bash` sets up `/bin`, `/dev`, `/proc`, `/tmp` and the working directory in its base. Paths on a filesystem without synchronous writes throw `ENOSYS` and are left out of the layout.
