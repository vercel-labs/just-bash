---
"just-bash": patch
---

`date -u -d` now reads the input as UTC, like GNU date. Before, with `TZ` set, the input was parsed in `TZ` and only the output was UTC, so `date -u -d 2026-03-03` printed the previous day east of UTC.

Timezone-naive `-d` input with fractional seconds (`2026-03-03T12:00:00.500`) is now also read in `TZ` (or UTC with `-u`) instead of the host timezone.
