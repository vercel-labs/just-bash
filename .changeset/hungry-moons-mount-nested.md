---
"just-bash": minor
---

Add `allowNestedMounts` to `MountableFs`, letting a mount sit inside another mount. With the option set, mounting `/data/private` inside an existing `/data` mount shadows that subtree the way an OS mount does: the deepest mount owning a path wins, so `/data/private/key` routes to the inner filesystem while `/data/notes.txt` stays with the outer one, and unmounting reveals the outer filesystem's contents again. This makes it possible to hide a subdirectory of a mounted filesystem behind a restricted one without wrapping the whole filesystem in a decorator. The option defaults to `false`, which keeps the existing behavior of rejecting overlapping mounts.
