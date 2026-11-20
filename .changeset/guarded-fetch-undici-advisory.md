---
"just-bash": patch
---

Update guarded-fetch to 0.2.0 so installs resolve undici 7.30.1 instead of 7.29.0. This clears GHSA-rfgv-xxqx-mfg5 and the other undici advisories fixed in 7.30.1, so consumers no longer need an undici override for just-bash.
