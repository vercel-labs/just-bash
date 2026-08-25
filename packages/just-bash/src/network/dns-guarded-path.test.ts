/**
 * DNS-rebinding protection on the guarded path (`denyPrivateRanges: true`).
 *
 * guarded-fetch owns resolution, so these drive it by mocking
 * `node:dns/promises` — which only reaches it because the vitest configs
 * inline guarded-fetch. The transport comes from `_fetch`, so a request that
 * passes the DNS check still never leaves the process, and the guarded path
 * cannot quietly fall back to ambient host state.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SecureFetch } from "./fetch.js";
import type { NetworkConfig } from "./types.js";

type LookupResult = { address: string; family: number };

const lookup = vi.fn<(hostname: string) => Promise<LookupResult[]>>();

vi.mock("node:dns/promises", () => {
  const mocked = (hostname: string) => lookup(hostname);
  return { lookup: mocked, default: { lookup: mocked } };
});

/** Resolve every hostname to the given addresses. */
function resolvesTo(...addresses: LookupResult[]): void {
  lookup.mockImplementation(async () => addresses);
}

/** Fail resolution with a Node DNS error code. */
function resolutionFails(code: string): void {
  lookup.mockImplementation(async () => {
    const error = new Error(`queryA ${code}`) as NodeJS.ErrnoException;
    error.code = code;
    throw error;
  });
}

const PUBLIC: LookupResult = { address: "93.184.216.34", family: 4 };

let createSecureFetch: (config: NetworkConfig) => SecureFetch;
/** Error classes from the same fresh graph, or `instanceof` never matches. */
let errors: typeof import("./types.js");

beforeAll(async () => {
  // Under `isolate: false` another file may already hold guarded-fetch with
  // the real resolver bound, so re-import to put this file's mock in force.
  vi.resetModules();
  [{ createSecureFetch }, errors] = await Promise.all([
    import("./fetch.js"),
    import("./types.js"),
  ]);

  // Without the inline setting the mock never reaches guarded-fetch and this
  // file would quietly resolve real hostnames, testing nothing.
  resolvesTo(PUBLIC);
  try {
    await createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      _fetch: async () => new Response("probe"),
    })("https://mock-probe.example/");
  } catch {
    // Only whether the resolver was consulted matters here.
  }
  if (lookup.mock.calls.length === 0) {
    throw new Error(
      'node:dns/promises mock did not reach guarded-fetch. Add "guarded-fetch" ' +
        "to test.server.deps.inline in the vitest config running this file.",
    );
  }
  lookup.mockReset();
});

afterEach(() => {
  lookup.mockReset();
});

describe("guarded path: resolved private addresses are rejected", () => {
  const privateAddresses: Array<[string, LookupResult]> = [
    ["loopback IPv4", { address: "127.0.0.1", family: 4 }],
    ["10.0.0.0/8", { address: "10.0.0.1", family: 4 }],
    ["192.168.0.0/16", { address: "192.168.1.1", family: 4 }],
    ["172.16.0.0/12", { address: "172.16.0.1", family: 4 }],
    ["link-local metadata", { address: "169.254.169.254", family: 4 }],
    ["loopback IPv6", { address: "::1", family: 6 }],
  ];

  it.each(
    privateAddresses,
  )("blocks a host resolving to %s without reaching the transport", async (_label, address) => {
    resolvesTo(address);
    const transport = vi.fn(async () => new Response("unreachable"));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: true,
      _fetch: transport,
    });

    await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
      errors.NetworkAccessDeniedError,
    );
    await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
      "hostname resolves to private/loopback IP address",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks when only one of several resolved addresses is private", async () => {
    resolvesTo(PUBLIC, { address: "10.1.2.3", family: 4 });
    const transport = vi.fn(async () => new Response("unreachable"));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: true,
      _fetch: transport,
    });

    await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
      errors.NetworkAccessDeniedError,
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks a private resolution under full internet access too", async () => {
    resolvesTo({ address: "127.0.0.1", family: 4 });
    const transport = vi.fn(async () => new Response("unreachable"));
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      _fetch: transport,
    });

    await expect(secureFetch("https://anything.example/data")).rejects.toThrow(
      errors.NetworkAccessDeniedError,
    );
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("guarded path: resolution failures fail closed", () => {
  it.each([
    "ENOTFOUND",
    "ENODATA",
    "ETIMEDOUT",
    "ESERVFAIL",
  ])("blocks when resolution fails with %s", async (code) => {
    resolutionFails(code);
    const transport = vi.fn(async () => new Response("unreachable"));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: true,
      _fetch: transport,
    });

    await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
      errors.NetworkAccessDeniedError,
    );
    // A resolution failure keeps its own message: reporting it as a private
    // address would hide which check actually refused the request.
    await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
      "Network access denied: DNS resolution failed for private IP check: " +
        "https://api.example.com/data",
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks on an empty DNS answer", async () => {
    resolvesTo();
    const transport = vi.fn(async () => new Response("unreachable"));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: true,
      _fetch: transport,
    });

    await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
      errors.NetworkAccessDeniedError,
    );
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("guarded path: allowed hosts are still resolved", () => {
  it("resolves an allow-listed host rather than skipping the SSRF check", async () => {
    resolvesTo(PUBLIC);
    const transport = vi.fn(async () => new Response("body", { status: 200 }));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: true,
      _fetch: transport,
    });

    const result = await secureFetch("https://api.example.com/data");

    expect(result.status).toBe(200);
    expect(lookup).toHaveBeenCalledWith("api.example.com");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("re-resolves the target of every redirect hop", async () => {
    lookup.mockImplementation(async (hostname) =>
      hostname === "api.example.com"
        ? [PUBLIC]
        : [{ address: "127.0.0.1", family: 4 }],
    );
    const transport = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://internal.example.com/data" },
        }),
    );
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: [
        "https://api.example.com",
        "https://internal.example.com",
      ],
      denyPrivateRanges: true,
      _fetch: transport,
    });

    // The first hop passes: only the redirect target resolves to loopback.
    await expect(secureFetch("https://api.example.com/start")).rejects.toThrow(
      errors.RedirectNotAllowedError,
    );
    expect(lookup).toHaveBeenCalledWith("internal.example.com");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("still enforces the redirect cap on the guarded path", async () => {
    resolvesTo(PUBLIC);
    const transport = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://api.example.com/loop" },
        }),
    );
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: true,
      maxRedirects: 2,
      _fetch: transport,
    });

    await expect(secureFetch("https://api.example.com/loop")).rejects.toThrow(
      errors.TooManyRedirectsError,
    );
    expect(transport).toHaveBeenCalledTimes(3);
  });
});

describe("private-range enforcement off skips resolution", () => {
  it("never resolves DNS when denyPrivateRanges is false", async () => {
    const transport = vi.fn(async () => new Response("body", { status: 200 }));
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://api.example.com"],
      denyPrivateRanges: false,
      _fetch: transport,
    });

    const result = await secureFetch("https://api.example.com/data");

    expect(result.status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("reaches private literals only with enforcement off", async () => {
    const transport = vi.fn(async () => new Response("body", { status: 200 }));
    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: false,
      _fetch: transport,
    });

    const result = await secureFetch("http://127.0.0.1:9/data");

    expect(result.status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("removed internal hooks fail loudly", () => {
  it("rejects _dnsResolve instead of silently ignoring it", () => {
    expect(() =>
      createSecureFetch({
        allowedUrlPrefixes: ["https://api.example.com"],
        denyPrivateRanges: true,
        _dnsResolve: async () => [PUBLIC],
      }),
    ).toThrow("_dnsResolve is no longer supported");
  });

  it("rejects _createConnectionOwner instead of silently ignoring it", () => {
    expect(() =>
      createSecureFetch({
        allowedUrlPrefixes: ["https://api.example.com"],
        denyPrivateRanges: true,
        _createConnectionOwner: async () => ({
          fetch: async () => new Response(""),
          async close() {},
        }),
      }),
    ).toThrow("_createConnectionOwner is no longer supported");
  });
});
