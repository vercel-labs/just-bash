---
"just-bash": patch
---

fs: keep a file's permissions when it is overwritten on `InMemoryFs` and `OverlayFs`

Writing to an existing file replaced its mode with the `0644` default, so a truncating redirection or `sed -i` cleared the exec bit of a script and the next `./script` failed with `Permission denied` (exit 126). Real bash leaves the permissions of a truncated file alone, and GNU `sed -i` writes a replacement file that carries them over:

```sh
printf '#!/bin/bash\necho ran\n' > m.sh; chmod 755 m.sh
printf '#!/bin/bash\necho ran\n' > m.sh   # was 644, now 755
./m.sh                                    # was rc=126, now prints "ran"
```

This affected both `InMemoryFs` and `OverlayFs`, and `OverlayFs` is what the CLI, the interactive shell and `Sandbox` use, so the CLI path was broken too.

An overwrite now keeps the existing file's permission bits, while still applying the rule the kernel applies on `write(2)`: the set-user-ID bit is cleared, and the set-group-ID bit of a group-executable file is cleared, because a write must not be able to hand on privileges the writer does not control. An explicit mode passed by the caller still wins, and a new path still gets the default.

The preserved mode is the one the file already had, so an overwrite can only ever narrow what a script can do, never widen it.
