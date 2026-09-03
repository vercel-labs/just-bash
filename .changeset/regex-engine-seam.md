---
"just-bash": minor
---

Add `regexEngine` to `BashOptions`

Every user-provided pattern (grep, sed, awk, jq, `[[ =~ ]]`, …) is compiled and
matched through a `RegexEngine`. re2js remains the default and the only engine
shipped, so nothing changes for existing users. A Node.js host can give an
instance another linear-time engine — e.g. a native RE2 binding — with
`new Bash({ regexEngine })`; the engine is scoped to that instance's executions,
so instances with different engines can run concurrently. `re2jsEngine` is
exported for hosts that want to wrap or fall back to the default, together with
the `RegexEngine`, `CompiledRegex`, `RegexMatcher`, `RegexEngineFlags` types and
the `RegexSyntaxError` an engine throws for unsupported or invalid patterns.

The engine must guarantee linear-time matching for every pattern it accepts;
`UserRegex`'s ReDoS protection is exactly that property, and `THREAT_MODEL.md`
now says so. The option is Node.js only: scoping relies on `AsyncLocalStorage`,
which the browser build does not have, so `new Bash({ regexEngine })` throws there.
