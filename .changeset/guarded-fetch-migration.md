---
"just-bash": minor
---

Replace bespoke `secureFetch` with `guarded-fetch` 0.1.3 for the SSRF/DNS-rebinding/transport layer

`src/network/fetch.ts` becomes an adapter over
[`guarded-fetch`](https://www.npmjs.com/package/guarded-fetch) (0.1.3, Vercel,
Apache-2.0, undici-backed). The public `createSecureFetch` / `SecureFetch` /
`SecureFetchOptions` / `FetchResult` contract is unchanged, so Bash, curl, and
worker-bridge callers need no changes.

**Delegated**: SSRF/private-IP blocking, DNS-rebinding protection (connect-time
IP pinning), protocol allow-listing, URL validation.

**Retained**: path-prefix allow-list (guarded-fetch is hostname-only), firewall
header transforms, response-size limits, `FetchResult` translation, and error
mapping back to just-bash's domain errors.

**Redirects** are still driven here so firewall headers and path policy are
re-applied per hop. Method rewriting follows the fetch standard (301/302 rewrite
POST only, 303 rewrites all but GET/HEAD, 307/308 preserve both), the rewritten
method is re-checked against `allowedMethods`, and user credentials are dropped
on cross-origin hops.

**Transport**: with `denyPrivateRanges` on, requests use guarded-fetch's own
undici `fetch` — a host-wrapped `globalThis.fetch` (framework fetch cache, APM
agent, request mocking) can rebuild the init and drop the non-standard
`dispatcher`, silently reopening the rebinding window. With it off, no pinning
is promised and the ambient `fetch` is used.

**Browser**: no guarded transport exists (undici is Node-only), so the ambient
`fetch` path is kept and `denyPrivateRanges` fails closed with "DNS pinning
unavailable for private IP enforcement", matching the old
`DnsPinningUnavailableError`. The bundle contains no import of `guarded-fetch`.

**Not delegated**: header sanitization (`sanitizeHeaders: false`) — just-bash's
firewall headers are its own layer, and the sandbox may set Cookie/Host via
curl; and guarded-fetch's own redirect following, for the reason above.

## Breaking-ish notes

- Node engine floor `>=20.18.1` → `>=20.19` (guarded-fetch's).
- `guarded-fetch` is externalized in the `build:lib`, `build:lib:cjs`, and
  `build:browser` bundles. Consumers who re-bundle just-bash must mark it
  external; `AGENTS.npm.md` now documents all six such packages.
- `NetworkConfig._dnsResolve` and `._createConnectionOwner` (both `@internal`)
  can no longer be honored and now **throw**, rather than being accepted while a
  weaker policy runs. `._fetch` replaces them for tests.
- Header keys arrive lowercased (undici `Headers`); a few assertions updated.
- A redirect hop blocked on its own address reports `RedirectNotAllowedError`
  (curl 47) as before, and a resolution failure keeps its own message.

## Tests

`dns-guarded-path.test.ts` covers the enforcing path by mocking
`node:dns/promises` (guarded-fetch is inlined in the vitest configs so the mock
reaches it): resolve-then-reject-private, fail-closed on resolution failure and
empty answers, allow-listed hosts still resolved (the regression guard for
`skipSsrfCheckForAllowedHosts`), per-hop re-resolution, and no resolution at all
when enforcement is off. `browser-build.test.ts` bundles the module the way
`build:browser` does and asserts no `guarded-fetch` import, no unhandled
rejection on import, ambient-`fetch` requests, and fail-closed enforcement.
