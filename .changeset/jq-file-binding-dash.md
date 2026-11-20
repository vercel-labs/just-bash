---
"just-bash": patch
---

Open a file named `-` for jq's `--rawfile` and `--slurpfile`, as jq does, instead of binding stdin. Previously `jq --slurpfile x - .` bound the same stdin that jq then read as its input. Binding files are now read one at a time and charged to the input budget before jq keeps them, and a `--rawfile` value is held to the string length limit. As in jq, the first `--arg`, `--argjson`, `--rawfile` or `--slurpfile` for a name wins, and later ones for that name are neither parsed nor read.
