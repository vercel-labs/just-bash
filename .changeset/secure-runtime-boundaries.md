---
"just-bash": minor
---

Harden untrusted execution with shared aggregate budgets, liberal normal and
opt-in hardened limit profiles, request-bound network validation, bounded
archive and worker processing, transactional filesystem and shell state, and
expanded adversarial regression checks.

Established command declarations and host-extension defaults remain source
compatible. Dispatched callbacks receive a `ResolvedCommandContext` with
required limits; applications can use `createCommandContext({ fs })` for direct
invocation, opt into restricted custom-command execution with `trusted: false`,
and select tighter resource policy with the `hardened` profile.
