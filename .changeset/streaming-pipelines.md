---
"just-bash": minor
---

Run simple command pipelines concurrently with bounded pipes and backpressure when a stage opts into streaming, so a consumer that exits early stops its producer. `cat`, `head`, and `seq` stream; custom commands opt in with `streaming: true` and read and write through `ctx.stdio`.
