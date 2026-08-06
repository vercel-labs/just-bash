---
"just-bash": patch
---

network: restore private-range-enforced requests from the bundled build

Every request made with `denyPrivateRanges` enabled failed with `Network access denied: DNS pinning unavailable for private IP enforcement`, so `curl` could not reach any host at all. The published ESM bundle was affected; source consumers and the CommonJS bundle were not.

The pinned connection owner reads `Agent` and `fetch` off a dynamic `import("undici")`. Node's resolution of the package exposes those as named exports, but the ESM build inlines undici's CommonJS module into a chunk whose namespace carries it under `default` alone, so `Agent` was `undefined` and the `TypeError` from constructing it was reported as a runtime incapable of pinning.

The namespace is now normalized before the transport is read off it, which also covers a consumer that bundles just-bash further.
