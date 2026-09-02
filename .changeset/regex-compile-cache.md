---
"just-bash": patch
---

regex: cache compiled RE2 patterns across `UserRegex` constructions

Every `createUserRegex()` call recompiled its pattern from source
(`translateRegExp` → parse → simplify → compile). Commands that build a
`UserRegex` inside a per-row loop therefore recompiled the same pattern once per
row: jq's `test`/`match`/`capture`/`scan`/`splits`/`sub`/`gsub`, awk's `~`/`!~`
and `sub`/`gsub`/`match`/`split`, and sed's `s///` (which compiled the same
pattern twice per line for the `g` and Nth-occurrence paths). Compiling costs
~23µs against ~1.5µs to match with an already-compiled pattern, so compilation
dominated these workloads.

Compiled patterns are now memoized in a 256-entry cache keyed on the pattern and
the RE2 flags, mirroring the existing glob regex cache in `src/utils/glob.ts`.
Patterns longer than 1024 characters are compiled but not retained, bounding the
cache's retained pattern source at 256 KiB. Only the compiled pattern is shared — `lastIndex`, the reusable matcher, result
limits and the abort signal stay per-instance, so matching semantics are
unchanged. Over 100k rows: jq `test()` 8.96s → 4.26s, awk `~` 4.15s → 2.55s,
awk `gsub` 7.16s → 6.10s, sed `s///g` 10.46s → 8.29s. Commands that already
hoisted compilation out of their loop (grep, rg) are unaffected.
