/**
 * Request-owned connection binding for DNS-reviewed HTTP requests.
 *
 * Each owner has a private Undici Agent whose connector resolves exactly one
 * hostname to exactly one preflight-reviewed address. The Agent is never
 * shared between requests or redirect hops, so an existing origin pool cannot
 * substitute a socket opened under a different DNS decision.
 *
 * The browser build removes the Node-only `undici` branch and edge runtimes
 * that cannot construct this owner fail closed when private-range denial is
 * enabled.
 */

declare const __BROWSER__: boolean | undefined;
const IS_BROWSER = typeof __BROWSER__ !== "undefined" && __BROWSER__;

export interface PinnedAddress {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export interface PinnedConnectionOwner {
  fetch(url: string, init: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export type PinnedConnectionOwnerFactory = (
  pinned: PinnedAddress,
) => Promise<PinnedConnectionOwner>;

export class DnsPinningUnavailableError extends Error {
  constructor() {
    super("DNS pinning is unavailable in this runtime");
    this.name = "DnsPinningUnavailableError";
  }
}

/**
 * Both shapes a dynamic `import("undici")` can resolve to.
 *
 * Node resolves the package and exposes its CommonJS exports as named ones. A
 * bundler that inlines the same module into its own graph cannot always do
 * that, and hands back a namespace carrying the module under `default` alone.
 */
type UndiciNamespace =
  | typeof import("undici")
  | Pick<typeof import("undici"), "default">;

type UndiciExports = typeof import("undici") | typeof import("undici").default;

/** @internal Pure namespace normalization used by focused interop tests. */
export function _undiciExports(namespace: UndiciNamespace): UndiciExports {
  return "Agent" in namespace ? namespace : namespace.default;
}

type PinnedLookup = import("node:net").LookupFunction;

function lookupDenied(hostname: string): NodeJS.ErrnoException {
  const error = new Error(`ENOTFOUND ${hostname}`) as NodeJS.ErrnoException & {
    hostname?: string;
  };
  error.code = "ENOTFOUND";
  error.errno = -3008;
  error.syscall = "getaddrinfo";
  error.hostname = hostname;
  return error;
}

/** @internal Pure connector lookup used by focused binding tests. */
export function _createPinnedLookup(pinned: PinnedAddress): PinnedLookup {
  return (hostname, options, callback) => {
    const requestedFamily =
      options.family === "IPv4"
        ? 4
        : options.family === "IPv6"
          ? 6
          : options.family;
    if (
      hostname.toLowerCase() !== pinned.hostname.toLowerCase() ||
      (requestedFamily !== undefined &&
        requestedFamily !== 0 &&
        requestedFamily !== pinned.family)
    ) {
      callback(lookupDenied(hostname), "");
      return;
    }

    if (options.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };
}

/**
 * Create a disposable transport whose pool identity is the reviewed address.
 * The returned owner must be closed after the response body is consumed.
 */
export const createPinnedConnectionOwner: PinnedConnectionOwnerFactory = async (
  pinned,
) => {
  if (IS_BROWSER) throw new DnsPinningUnavailableError();

  try {
    // This branch is removed from the browser build by __BROWSER__ folding.
    // Read the transport off the normalized namespace: a bundled undici is
    // reachable only through `default`, and `new undefined()` here would be
    // reported as a runtime that cannot pin rather than as the packaging
    // problem it is.
    const { Agent, fetch: undiciFetch } = _undiciExports(
      await import("undici"),
    );
    const agent = new Agent({
      connections: 1,
      pipelining: 0,
      connect: {
        lookup: _createPinnedLookup(pinned),
      },
    });

    let closed = false;
    return {
      async fetch(url, init) {
        if (closed) throw new DnsPinningUnavailableError();
        const boundFetch = undiciFetch as unknown as (
          input: string,
          options: unknown,
        ) => Promise<unknown>;
        return (await boundFetch(url, {
          ...init,
          dispatcher: agent,
        })) as Response;
      },
      async close() {
        if (closed) return;
        closed = true;
        // destroy(), rather than close(), also tears down a request whose body
        // or peer did not finish cleanly. It is safe after a consumed response.
        await agent.destroy();
      },
    };
  } catch (error) {
    if (error instanceof DnsPinningUnavailableError) throw error;
    throw new DnsPinningUnavailableError();
  }
};
