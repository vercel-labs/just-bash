---
"just-bash": minor
---

Replace bespoke `secureFetch` with `guarded-fetch` 0.1.3 for the SSRF/DNS-rebinding/transport layer

## Summary

The network module's bespoke `createSecureFetch` implementation is replaced by an
adapter that delegates the SSRF, DNS-rebinding, and transport layer to the
[`guarded-fetch`](https://www.npmjs.com/package/guarded-fetch) package (0.1.3,
published by Vercel, Apache-2.0, backed by undici).

just-bash's public `createSecureFetch` / `SecureFetch` / `SecureFetchOptions` /
`FetchResult` contract is preserved unchanged, so all consumers (Bash, curl,
worker-bridge HTTP requests) continue to work without caller-side changes.

## What changed

### `src/network/fetch.ts` (rewritten as adapter)
- **Delegated to guarded-fetch**: SSRF/private-IP blocking, DNS-rebinding
  protection (connect-time IP pinning via its guarded dispatcher), protocol
  allow-listing, per-request URL safety validation.
- **Retained by just-bash**: path-prefix allow-list (guarded-fetch is
  hostname-only), firewall header transforms (credentials brokering),
  response-size limits, `FetchResult` translation, `GuardedFetchError` →
  domain error mapping.
- **Manual redirect following** with per-hop: path-prefix allow-list re-check,
  method/body rewriting per the fetch standard (301/302 rewrite POST only, 303
  rewrites every method except GET/HEAD, 307/308 preserve both) with the
  rewritten method re-checked against `allowedMethods`, and cross-origin
  credential stripping (user-supplied Authorization/Cookie dropped when the
  redirect changes origin; firewall-injected credentials are re-applied per
  hop).
- **Transport selection**: with `denyPrivateRanges` on, requests go through
  guarded-fetch's own undici `fetch` — the only transport guaranteed to honor
  the guarded `dispatcher` that re-validates the resolved IP inside the socket
  connect. A host-wrapped `globalThis.fetch` (framework fetch cache, APM
  instrumentation, request mocking) can rebuild the init object and drop that
  non-standard option, silently reopening the DNS-rebinding window. With
  `denyPrivateRanges` off no pinning is promised, so the ambient `fetch` is
  used and host shims keep working.
- **Browser build**: guarded-fetch is loaded via a `__BROWSER__`-folded dynamic
  import that runs eagerly at module-init time on Node (so the defense-in-depth
  loader hook doesn't block guarded-fetch's internal `node:dns/promises`
  import). The browser build has no guarded transport, so it keeps the ambient
  `fetch` path the bespoke implementation used, and fails closed with
  `NetworkAccessDeniedError` ("DNS pinning unavailable for private IP
  enforcement") when `denyPrivateRanges` is requested — matching the old
  `DnsPinningUnavailableError` mapping. The browser bundle contains no import
  of `guarded-fetch`.
- **Defense-in-depth**: `guardedFetch` runs inside `DefenseInDepthBox.runTrustedAsync`
  (matching the bespoke pattern) so Agent/FinalizationRegistry creation is
  trusted. Preflight checks are inside the `try/finally` so denied requests
  clean up their timeout timer and abort listeners (matching the bespoke
  implementation).

### Build
- `guarded-fetch` externalized in `build:lib` (ESM), `build:lib:cjs`, and
  `build:browser` esbuild bundles.
- Node engine floor raised from `>=20.18.1` to `>=20.19` (guarded-fetch
  requires `>=20.19`).

### Lint
- New banned pattern: any reference to the ambient `fetch` in
  `src/network/fetch.ts` must carry an audit annotation. The previous
  raw-`fetch` rule could not see `globalThis.fetch(...)`.

## NOT delegated (intentionally disabled)
- **Header sanitization** (`sanitizeHeaders: false`): just-bash's firewall-header
  system is its own sanitization layer. The sandbox can set cookies/Host via
  curl; guarded-fetch's blanket stripping would break that contract.
- **guarded-fetch's built-in redirect following** (`followRedirects: false`):
  redirects are driven here so firewall headers are re-applied per hop and
  path-scoped allow-listing is re-checked.

## Behavioral notes
- Header keys are normalized to lowercase via `Headers` (guarded-fetch uses
  undici `Headers` internally). A small number of test assertions were updated.
- `_dnsResolve` and `_createConnectionOwner` on `NetworkConfig` (both
  `@internal`) can no longer be honored: guarded-fetch resolves and pins
  internally and exposes no seam for them. `createSecureFetch` now **throws**
  when either is passed, rather than accepting it and running a weaker policy
  than the embedder asked for. A new `@internal` `_fetch` replaces them for
  tests that need to intercept the transport on the enforcing path.
- A redirect hop blocked on its own address now reports
  `RedirectNotAllowedError` (curl exit 47), as it did before the migration,
  rather than the first-hop `NetworkAccessDeniedError`. A DNS resolution
  failure keeps its own message ("DNS resolution failed for private IP check")
  instead of being reported as a private address.

## Tests
- `src/network/dns-guarded-path.test.ts` covers the enforcing path by mocking
  `node:dns/promises` (guarded-fetch is inlined in `vitest.config.ts` so the
  mock reaches its resolver): resolve-then-reject-private, fail-closed on
  resolution failure and empty answers, allow-listed hosts still resolved (the
  regression guard for `skipSsrfCheckForAllowedHosts`), per-hop re-resolution,
  and no resolution at all when enforcement is off.
- `src/network/browser-build.test.ts` bundles the module the way
  `build:browser` does and asserts: no `guarded-fetch` import, no unhandled
  rejection on import, requests served through the ambient `fetch`, allow-list
  still enforced, and fail-closed under `denyPrivateRanges`.
- Redirect method rewriting is covered per status/method pair, including the
  refusal when the rewritten GET is outside `allowedMethods`.

## Verification
- `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm build` — all clean.
- Browser bundle: no `guarded-fetch` import (the name appears only in error
  text).
- `src/network/`, `src/commands/curl/`, `src/commands/worker-bridge/`: 562/562
  pass. `pnpm test:wasm`: 675 pass. Full suite matches `main`'s pre-existing
  failures (tar/xz native codec, and load-dependent flakes in the python3 /
  js-exec worker suites).
