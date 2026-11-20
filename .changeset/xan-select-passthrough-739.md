---
"just-bash": patch
---

Fix `xan select` (and every CSV-to-CSV command) mangling cells that only look typed: leading-zero codes like `01067` were re-serialized as `1067` and ISO timestamps like `2026-03-03T10:00:00Z` were emptied entirely, because the CSV parser re-typed cells. Cells are now kept as text, matching real xan's pass-through behavior, and `xan to json` infers numbers and booleans at output time instead — while still keeping leading-zero codes and timestamps as strings.
