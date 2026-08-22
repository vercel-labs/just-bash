---
"just-bash": minor
---

Replace bespoke `secureFetch` with `guarded-fetch` 0.1.3 for the SSRF/DNS-rebinding/redirect/transport layer

## Summary

The network module's bespoke `createSecureFetch` implementation is replaced by an
adapter that delegates the SSRF, DNS-rebinding, redirect re-validation, and
connect-time IP-pinning layer to the [`guarded-fetch`](https://www.npmjs.com/package/guarded-fetch)
package (0.1.3, published by Vercel, Apache-2.0, backed by undici).

just-bash's public `createSecureFetch` / `SecureFetch` / `SecureFetchOptions` /
`FetchResult` contract is preserved unchanged, so all consumers (Bash, curl,
worker-bridge HTTP requests) continue to work without caller-side changes.

## What changed

- **New dependency**: `guarded-fetch@0.1.3` (depends on `undici` and
  `ipaddr.js`, both already in the tree or compatible).
- **`src/network/fetch.ts`** is rewritten as an adapter:
  - Delegates SSRF/private-IP/DNS-rebinding protection, protocol allow-listing,
    connect-time IP pinning, and redirect re-validation to `guardedFetch`.
  - Retains just-bash's path-prefix allow-list (guarded-fetch is hostname-only),
    firewall header transforms (credentials brokering at the fetch boundary),
    response-size limits, and `FetchResult` translation.
  - Drives redirects manually (rather than relying on guarded-fetch's built-in
    redirect following) so firewall headers are re-applied per hop and path-scoped
    allow-listing is re-checked.
  - Maps `GuardedFetchError` codes onto just-bash's domain error types
    (`NetworkAccessDeniedError`, `RedirectNotAllowedError`, etc.).
- **Build**: `guarded-fetch` is externalized in the lib (ESM/CJS) and browser
  esbuild bundles.
- **`pnpm-workspace.yaml`**: `guarded-fetch` added to `minimumReleaseAgeExclude`
  to bypass the global min-release-age gate for this freshly published version.

## Behavioral notes

- Header keys are now normalized to lowercase via `Headers` (guarded-fetch uses
  undici `Headers` internally). The bespoke implementation preserved original
  caller casing for pass-through headers. This is standard `Headers` behavior and
  does not affect security; a small number of test assertions were updated.
- `_dnsResolve` and `_createConnectionOwner` test-injection hooks on
  `NetworkConfig` are no longer consumed by the adapter (guarded-fetch resolves
  DNS internally without an injection seam). The fields remain on
  `NetworkConfig` for type compatibility but are ignored at runtime.
- `dns-pin.ts` (request-owned undici Agent) is retained for its pure utility
  tests but is no longer in the fetch hot path; guarded-fetch's shared guarded
  dispatcher now provides connect-time IP pinning.

## Test changes

- `firewall.test.ts`: `extractHeaders` updated to use `forEach` (handles both
  undici and global `Headers`); one assertion updated for lowercase header keys.
- `dns-pin-fetch.test.ts`: rewritten from bespoke connection-owner internals to
  public `createSecureFetch` behavior (responses, redirects, timeouts, abort).
- `dns-rebinding.test.ts`: rewritten to test through the public surface (lexical
  private-IP blocking, `denyPrivateRanges=false` skip, error mapping) since the
  `_dnsResolve` fake-DNS seam is no longer available.
- `e2e.test.ts`: one test updated to use a real-resolvable domain
  (`evil.com`) for the `denyPrivateRanges: true` full-internet case.
- `bypass.test.ts`: two assertions updated for URL normalization (default port
  stripping and hostname lowercasing) now applied by guarded-fetch.
- Removed unused test helpers `expectBlockedDnsPrivate` / `expectBlockedDnsFailure`
  from `shared.ts` (they asserted bespoke error messages that no longer match).

## Verification

- `pnpm typecheck`, `pnpm lint:fix`, `pnpm knip` — all clean.
- `pnpm test:run src/network/ src/commands/worker-bridge/ src/commands/curl/` —
  all 530 tests pass.
