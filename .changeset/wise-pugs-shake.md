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

The mode now comes from the entry's own metadata via `lstat`, so `chmod` is reflected for files, directories, `.` and `..`, and broken symlinks are listed as the links they are rather than as missing files.