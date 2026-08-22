---
"just-bash": patch
---

Prevent defense-in-depth violation reporting from recursively overflowing the call stack in host runtimes that wrap `Date.now()`, honor configured main-thread violation exclusions, include actionable exclusion guidance for configurable violations, and keep constructor-execution protections non-excludable.
