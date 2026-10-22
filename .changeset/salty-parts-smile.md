---
"just-bash": patch
---

Use RE2JS's capture-free API for Boolean regex tests so searches can use the existing DFA without computing discarded match positions.
