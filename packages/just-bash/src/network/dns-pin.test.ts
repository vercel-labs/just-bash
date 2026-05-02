/**
 * Unit tests for the dns-pin AsyncLocalStorage-scoped dns.lookup
 * interception used to defeat DNS rebinding attacks.
 *
 * The fix replaces only the resolution that fetch's underlying socket
 * does at connect time, so calls outside the pinning context must be
 * unaffected.
 */
import dns from "node:dns";
import { describe, expect, it } from "vitest";
import { _ensureDnsHookInstalled, pinDns } from "./dns-pin.js";

function lookupCb(
  hostname: string,
  options: dns.LookupOptions = {},
): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, ...options }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses as { address: string; family: number }[]);
    });
  });
}

function lookupSingle(
  hostname: string,
): Promise<{ address: string; family: number }> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

describe("dns-pin", () => {
  it("returns the pinned address inside the pinning context (all=true)", async () => {
    const result = await pinDns(
      { hostname: "rebind.example", address: "1.2.3.4", family: 4 },
      () => lookupCb("rebind.example"),
    );
    expect(result).toEqual([{ address: "1.2.3.4", family: 4 }]);
  });

  it("returns the pinned address inside the pinning context (callback form)", async () => {
    const result = await pinDns(
      { hostname: "rebind.example", address: "1.2.3.4", family: 4 },
      () => lookupSingle("rebind.example"),
    );
    expect(result).toEqual({ address: "1.2.3.4", family: 4 });
  });

  it("ignores hostname mismatch — falls through to original dns.lookup", async () => {
    // Inside the pinning context for "evil.example" we look up "localhost".
    // The pinning entry must NOT apply, and the original dns.lookup runs.
    const result = await pinDns(
      { hostname: "evil.example", address: "1.2.3.4", family: 4 },
      () => lookupCb("localhost"),
    );
    // localhost resolves to loopback (127.0.0.1 or ::1)
    const hasLoopback = result.some(
      ({ address }) => address === "127.0.0.1" || address === "::1",
    );
    expect(hasLoopback).toBe(true);
    // And NOT the pinned address
    const hasPinned = result.some(({ address }) => address === "1.2.3.4");
    expect(hasPinned).toBe(false);
  });

  it("hostname match is case-insensitive", async () => {
    const result = await pinDns(
      { hostname: "Mixed.Case.Example", address: "1.2.3.4", family: 4 },
      () => lookupCb("mixed.case.example"),
    );
    expect(result).toEqual([{ address: "1.2.3.4", family: 4 }]);
  });

  it("outside pinning context, dns.lookup behaves normally", async () => {
    _ensureDnsHookInstalled();
    // No pinning context — should hit real DNS for "localhost".
    const result = await lookupCb("localhost");
    const hasLoopback = result.some(
      ({ address }) => address === "127.0.0.1" || address === "::1",
    );
    expect(hasLoopback).toBe(true);
  });

  it("family mismatch fails closed with ENOTFOUND", async () => {
    // Pinned address is family=4, but caller asks for family=6 — the
    // fix returns ENOTFOUND rather than silently substituting an IPv4.
    await expect(
      pinDns(
        { hostname: "rebind.example", address: "1.2.3.4", family: 4 },
        () =>
          new Promise<void>((resolve, reject) => {
            dns.lookup(
              "rebind.example",
              { family: 6 },
              (err: NodeJS.ErrnoException | null) => {
                if (err) reject(err);
                else resolve();
              },
            );
          }),
      ),
    ).rejects.toMatchObject({ code: "ENOTFOUND" });
  });

  it("concurrent pin contexts do not leak between async chains", async () => {
    // Two simultaneous pinDns() calls with different addresses for the
    // same hostname must each see their own pinned value.
    const [a, b] = await Promise.all([
      pinDns({ hostname: "x.example", address: "1.1.1.1", family: 4 }, () =>
        lookupCb("x.example"),
      ),
      pinDns({ hostname: "x.example", address: "2.2.2.2", family: 4 }, () =>
        lookupCb("x.example"),
      ),
    ]);
    expect(a).toEqual([{ address: "1.1.1.1", family: 4 }]);
    expect(b).toEqual([{ address: "2.2.2.2", family: 4 }]);
  });
});
