---
"just-bash": minor
---

sandbox: forward capability flags from `SandboxOptions` into the underlying `Bash`

`Sandbox.create(opts)` previously constructed its internal `Bash` with only a subset
of `BashOptions`, silently dropping the optional capability flags (`python`,
`javascript`, `commands`, `customCommands`, `fetch`). A host that drives just-bash
through the `Sandbox` API (rather than `new Bash(...)`) therefore could not enable
python3, js-exec, a restricted command set, custom commands, or a custom fetch — even
though the runtimes ship in the package.

`SandboxOptions` now exposes those fields and `Sandbox.create` forwards them into the
`Bash` it builds. Behavior is unchanged when a caller omits them (each falls back to
its existing `BashOptions` default — Python/js-exec stay off, the full command set
stays available). Fixes the root cause behind vercel/eve#431.
