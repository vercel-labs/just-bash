---
"just-bash": patch
---

ln: report a refused symlink as a symlink failure, not as a hard link on a directory

`ln -s` against a filesystem constructed without symlink support failed with `ln: 'file.txt': hard link not allowed for directory`. Nothing in that sentence is true of the call: `-s` asks for a symbolic link rather than a hard one, and the named operand is the target rather than the directory the message blames.

Both link kinds shared one `EPERM` branch, which carried the hard-link wording unconditionally. `link` reports `EPERM` only for a directory, so that wording is right there and is kept. `symlink` reports it when the filesystem allows no symlinks at all, which is a different condition with a different remedy, and it now reads `ln: failed to create symbolic link 'link': Operation not permitted`, matching the shape GNU `ln` uses and the shape this command already uses for `File exists`.
