---
"just-bash": patch
---

Honour `#!` interpreters that resolve to registered commands, as a kernel does. An executable script whose first line is `#!/usr/bin/env <name> [arg]`, `#!/bin/<name> [arg]` or `#!/usr/bin/<name> [arg]`, where `<name>` is a registered command other than `bash` or `sh`, now runs as `<name> [arg] <script> <args...>` with the script's stdin. This makes `./x.py` with `#!/usr/bin/env python3` work when `python: true`, and lets custom commands serve as script interpreters. Any other shebang is skipped and the body runs as bash, as before.
