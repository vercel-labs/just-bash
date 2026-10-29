---
"just-bash": patch
---

Group jq deletion paths by their original container, copying each touched container once and charging that work to the query limit. Avoid serializing paths for deduplication.
