---
"just-bash": patch
---

fs: keep a file's permissions when it is overwritten on `InMemoryFs`

Writing to an existing file replaced its stored mode with the `0644` default, so `> file`, `>> file` and `sed -i` all cleared the exec bit of a script and the next `./script` failed with `Permission denied` (exit 126). Real bash leaves the permissions of a truncated file alone, and GNU `sed -i` copies them onto its replacement file:

```sh
printf '#!/bin/bash\necho ran\n' > m.sh; chmod 755 m.sh
printf '#!/bin/bash\necho ran\n' > m.sh   # was 644, now 755
./m.sh                                    # was rc=126, now prints "ran"
```

An overwrite now keeps the existing entry's mode, while an explicit mode passed
by the caller still wins, and a new path still gets the default.