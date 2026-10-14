---
"just-bash": patch
---

Keep a file's mode when it is overwritten on `InMemoryFs` and `OverlayFs`

`echo x > script.sh` and `sed -i` reset an existing file to `0644`, so an executable script stopped running and the next `./script.sh` exited 126. On `OverlayFs`, the first `>` or `>>` to an executable from the real directory also dropped its exec bit. An overwrite now keeps the file's mode, as `open(O_TRUNC)` does in bash. An explicit `mode` passed to `writeFileSync` or `writeFileLazy` still wins. A new file, or one written over a directory, a symlink, or a removed path, still gets `0644`. `ReadWriteFs` already kept the mode. Like Linux for an unprivileged writer, a write clears set-user-ID, and clears set-group-ID when the group can execute. An empty `>>` changes nothing. `mv` on `OverlayFs` now gives the destination the source's mode.
