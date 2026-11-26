---
"just-bash": minor
---

Add `executionLimits.maxJsMemoryBytes` to set the QuickJS heap for each `js-exec` run. The default stays 64 MiB in both profiles. Accepted values above 2147483647, the largest limit `run` accepts, including `Infinity`, clamp to that maximum. A value smaller than the host bridge buffer (just over 8 MiB by default) makes each `js-exec` run fail before guest code starts, with a message that names the option and the buffer size.
