---
"just-bash": minor
---

Add the `yes` command. `yes [STRING]...` repeats a line built from its operands (`y` when there are none), so `yes | head -3` and `yes | some-prompt` work instead of failing with exit 127. Because pipeline stages here run to completion rather than streaming, the stream is finite: it ends after `executionLimits.maxLoopIterations` lines, or earlier if the repeated line would exceed the output size limit.
