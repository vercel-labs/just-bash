---
"just-bash": patch
---

Support jq's standard ISO-8601 date builtin names: `fromdateiso8601` and `todateiso8601` previously failed as unknown functions, although the existing `fromdate` and `todate` aliases already implemented the same conversions. Both names now share those implementations (keeping their strict parsing, range checks, and invalid-input errors) and appear in the `builtins` list, matching native jq.
