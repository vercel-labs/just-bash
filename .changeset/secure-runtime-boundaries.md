---
"just-bash": major
---

Harden untrusted execution with shared aggregate budgets, liberal normal and
opt-in hardened limit profiles, request-bound network validation, bounded
archive and worker processing, transactional filesystem and shell state, and
expanded adversarial regression checks.

Custom commands now default to untrusted execution consistently across direct,
helper-created, and lazy registration. Commands that require host globals must
set `trusted: true`. `CommandContext.limits` is fully resolved and required;
use `createCommandContext({ fs })` when constructing a context in tests.
