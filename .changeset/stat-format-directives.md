---
"just-bash": minor
---

stat: expand every `-c` directive, and print `?` for one that cannot be answered

`stat -c '%Y' file` printed the two characters `%Y` and exited 0. The format expansion matched `/%[nNsFaAuUgG]/g` and returned any other directive as itself, so the whole timestamp family passed through as its own source text. `stat -c 'mtime=%Y'` is the idiom for reading a modification time, and its output was `mtime=%Y`, which looks like output rather than like a gap: nothing in the exit code, stderr, or the string says the value is missing.

- `%y` and `%Y` (modify) are expanded. `%y` renders as GNU does, `2024-01-15 09:17:14.764000000 +0000`, in `$TZ` when it names a zone Intl accepts or is a POSIX TZ string such as `EST5` or `EST5EDT,M3.2.0,M11.1.0`, and UTC otherwise, as glibc does for a value it cannot parse. It is built only when a FORMAT names it. The filesystem stores milliseconds, so the last six digits of the nanoseconds are always zero.
- `%w` / `%W` (birth) report `-` and `0`, which is what GNU prints where a filesystem does not record birth time.
- `%%` is a literal percent and a `%` at the end of FORMAT prints as itself. GNU's printf flags (`' - + space # 0 I`), a width and a `.precision` are parsed, and each directive keeps the flags GNU's printf call for it keeps: `%#a` is `0644`, `%#f` is `0x81a4`, `%.2n` truncates the name, `%05n` pads with spaces, and `%.3Y` prints milliseconds. A flag, width or precision on `%%` or on a trailing `%` is an invalid directive, reported and exiting 1 as in GNU.
- A directive with no value, whether unknown or naming something this filesystem does not record, prints a bare `?`, unpadded, as GNU prints an unknown one.
- Scanning FORMAT is charged against `maxLoopIterations` and the execution's work budget, so a huge literal FORMAT fails a limit instead of holding the event loop.
- `%a` is the permission bits alone. It was `stat.mode.toString(8)`, which carries the file type: a 0644 file reported `100644` where GNU reports `644`.
- `%f` is the raw mode in hexadecimal, with the type bits composed from `isDirectory` rather than read off `mode`, which carries them on some filesystems and not others.

`%n`, `%N`, `%s`, `%F`, `%A`, `%u`, `%U`, `%g` and `%G` are unchanged, as is the default output.

`%b`, `%B`, `%h`, `%i`, `%d`, `%D`, `%o`, `%t`, `%T` and `%m` print `?`, and so do the access and change times `%x`, `%X`, `%z` and `%Z`. Each names something `FsStat` does not carry (allocated blocks, link count, inode, device, mount point, two of the three timestamps), and inventing a plausible value for them is the failure this change is fixing. They are one small `FsStat` addition away if that is wanted.
