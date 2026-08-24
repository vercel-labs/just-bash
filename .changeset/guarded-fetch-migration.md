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
  protection (connect-time IP pinning via guarded dispatcher passed to
  `globalThis.fetch`, which Node's built-in undici fetch honors), protocol
  allow-listing, per-request URL safety validation.
- **Retained by just-bash**: path-prefix allow-list (guarded-fetch is
  hostname-only), firewall header transforms (credentials brokering),
  response-size limits, `FetchResult` translation, `GuardedFetchError` →
  domain error mapping.
- **Manual redirect following** with per-hop: path-prefix allow-list re-check,
  RFC 7231 method/body rewriting (301/302/303 → GET + drop body), and
  cross-origin credential stripping (user-supplied Authorization/Cookie
  dropped when the redirect changes origin; firewall-injected credentials
  are re-applied per hop).
- **Browser build**: guarded-fetch is loaded via `__BROWSER__`-folded dynamic
  import that runs eagerly at module-init time on Node (so the defense-in-depth
  loader hook doesn't block guarded-fetch's internal `node:dns/promises`
  import). The browser bundle contains zero references to `guarded-fetch`.
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

### Config
- `guarded-fetch` added to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.

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
- `_dnsResolve` and `_createConnectionOwner` on `NetworkConfig` are deprecated
  and no longer consumed (guarded-fetch resolves DNS internally). Retained for
  type compatibility.

## Verification
- `pnpm typecheck`, `pnpm lint:fix`, `pnpm knip`, `pnpm build` — all clean.
- Browser bundle: zero `guarded-fetch` references.
- 532/532 tests pass across `src/network/`, `src/commands/worker-bridge/`,
  `src/commands/curl/`.
