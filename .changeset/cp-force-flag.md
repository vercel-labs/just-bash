---
"just-bash": patch
---

`cp` now accepts `-f` / `--force` and matches POSIX behavior: when an existing destination file cannot be opened for writing, it is removed and the copy is retried. `-n` / `--no-clobber` keeps precedence over `-f`, so `cp -f -n` still skips an existing destination. Without the fix, `cp -f` failed with `cp: invalid option -- 'f'`, which broke automake-generated install rules such as ImageMagick's `cp -f $^ $@`.

Fixes #494.
