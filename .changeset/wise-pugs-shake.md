---
"just-bash": patch
---

Fix `ls -l` printing a hardcoded permission column, so listings now report each entry's real mode and render a symlink as `lrwxrwxrwx ... link -> target`:

```sh
echo a > f.sh; chmod 755 f.sh; ls -l f.sh
# was "-rw-r--r-- 1 user user     2 ...", now "-rwxr-xr-x 1 user user     2 ..."

ln -s f.sh link; ls -l link
# was "-rw-r--r-- 1 user user     2 ... link", now "lrwxrwxrwx 1 user user     4 ... link -> f.sh"
```

The mode now comes from the entry's own metadata via `lstat`, so `chmod` is reflected for files, directories, and the `.` and `..` entries a long listing adds. A directory listing now also reports a broken symlink as the link it is instead of dropping it into the unreadable-entry path. A broken symlink given directly as an operand still fails, as it did before, because `ls` still decides whether an operand is a directory by following it.

Symlinks are now described rather than refused under the default `allowSymlinks: false`. Previously `ls -ld link` and a symlink entry in `ls -l` reported `No such file or directory`; they now print the link's mode and target. Nothing new becomes readable: those same fields were already reachable through `readlink` and `ls -F`, and `ls` still never descends into a link, reads through one, or resolves `..` across one, so the traversal-containment gates in `real-fs-utils.ts` are untouched.
