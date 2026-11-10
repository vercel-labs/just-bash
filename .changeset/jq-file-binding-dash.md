---
"just-bash": patch
---

Open a file named `-` for jq's `--rawfile` and `--slurpfile`, as jq does, instead of binding stdin. Previously `jq --slurpfile x - .` bound the same stdin that jq then read as its input.
