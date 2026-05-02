/**
 * Pin DNS resolution for the actual fetch to the IPs that were validated
 * by the preflight private-range check, defeating DNS rebinding.
 *
 * How it works:
 * - `dns.lookup` is monkey-patched once globally to consult an
 *   AsyncLocalStorage store. When called inside a `pinDns(...)` async
 *   context for the same hostname, it returns the pre-validated address
 *   without performing any network DNS query.
 * - Calls outside any pinning context (or for a different hostname)
 *   are delegated to the original `dns.lookup`.
 *
 * Why `dns.lookup` and not `dns.promises.lookup`:
 * - Node's `net.connect`/`tls.connect` (used by undici under `globalThis.fetch`)
 *   reads `dns.lookup` at call time and uses the callback form.
 * - We do not patch the promises form because it's not on the connect path.
 *
 * Browser builds: this module is imported transitively from `fetch.ts`
 * (re-exported via `just-bash/browser`). `node:dns` is aliased to a
 * stub by the browser build, but `node:async_hooks` cannot be aliased
 * via a static import. We therefore lazy-load both via `require()`
 * inside an `IS_BROWSER === false` guard so esbuild can dead-code
 * eliminate the Node-only path. In the browser the exported `pinDns`
 * is a passthrough that just runs the callback (the preflight that
 * would have produced a `PinnedAddress` always throws first because
 * `node:dns` is unavailable, so the passthrough is unreachable).
 */

declare const __BROWSER__: boolean | undefined;
const IS_BROWSER = typeof __BROWSER__ !== "undefined" && __BROWSER__;

export interface PinnedAddress {
  hostname: string;
  address: string;
  family: 4 | 6;
}

type AsyncLocalStorageType<T> = {
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
};

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | { address: string; family: number }[],
  family?: number,
) => void;

let pinningStore: AsyncLocalStorageType<PinnedAddress> | null = null;
// biome-ignore lint/suspicious/noExplicitAny: dns module shape varies by runtime
let dnsModule: any = null;
let dnsHookInstalled = false;

function loadNodeDeps(): void {
  if (pinningStore !== null) return;
  if (IS_BROWSER) return;
  try {
    // require() so esbuild dead-code-eliminates this in the browser build.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asyncHooks = require("node:async_hooks");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    dnsModule = require("node:dns");
    pinningStore = new asyncHooks.AsyncLocalStorage();
  } catch {
    // Edge runtimes without async_hooks: leave pinningStore null.
    // pinDns becomes a passthrough; callers that expected pinning
    // (denyPrivateRanges + DNS resolution) will not get it on those
    // runtimes. The preflight DNS resolution itself would have failed
    // first if dns was unavailable, so this branch is mostly belt-and-
    // suspenders.
  }
}

function installDnsHook(): void {
  if (dnsHookInstalled) return;
  loadNodeDeps();
  if (!pinningStore || !dnsModule) return;
  dnsHookInstalled = true;

  const store = pinningStore;
  const originalLookup = dnsModule.lookup;

  function patchedLookup(this: unknown, ...args: unknown[]): unknown {
    const hostname = args[0];
    const pinned = store.getStore();

    if (
      typeof hostname !== "string" ||
      !pinned ||
      pinned.hostname.toLowerCase() !== hostname.toLowerCase()
    ) {
      return (originalLookup as (...a: unknown[]) => unknown).apply(this, args);
    }

    // @banned-pattern-ignore: static field access only (`family`, `all`)
    let options: { family?: number; all?: boolean } = {};
    let callback: LookupCallback | undefined;

    if (args.length === 2) {
      callback = args[1] as LookupCallback;
    } else if (args.length >= 3) {
      const raw = args[1];
      if (typeof raw === "number") {
        options = { family: raw };
      } else if (raw && typeof raw === "object") {
        options = raw as { family?: number; all?: boolean };
      }
      callback = args[2] as LookupCallback;
    }

    if (typeof callback !== "function") {
      return (originalLookup as (...a: unknown[]) => unknown).apply(this, args);
    }

    const cb = callback;

    if (
      options.family !== undefined &&
      options.family !== 0 &&
      options.family !== pinned.family
    ) {
      // Family mismatch — emulate ENOTFOUND so the connection fails closed
      // rather than silently returning a wrong-family address.
      const err = new Error(
        `ENOTFOUND ${hostname}`,
      ) as NodeJS.ErrnoException & { hostname?: string };
      err.code = "ENOTFOUND";
      err.errno = -3008;
      err.syscall = "getaddrinfo";
      err.hostname = hostname;
      process.nextTick(() => cb(err));
      return;
    }

    process.nextTick(() => {
      if (options.all) {
        cb(null, [{ address: pinned.address, family: pinned.family }]);
      } else {
        cb(null, pinned.address, pinned.family);
      }
    });
  }

  Object.defineProperty(dnsModule, "lookup", {
    value: patchedLookup,
    writable: true,
    configurable: true,
  });
}

/**
 * Run `fn` with `dns.lookup` for `pinned.hostname` resolving to
 * `pinned.address`/`pinned.family`. Resolutions for other hostnames
 * pass through to the original `dns.lookup`.
 */
export function pinDns<T>(
  pinned: PinnedAddress,
  fn: () => Promise<T>,
): Promise<T> {
  installDnsHook();
  if (!pinningStore) return fn();
  return pinningStore.run(pinned, fn);
}

/**
 * @internal Exposed for tests to verify the patched dns.lookup behaves
 * correctly inside and outside a pinning context.
 */
export function _ensureDnsHookInstalled(): void {
  installDnsHook();
}
