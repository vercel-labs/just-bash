/**
 * End-to-end test that secureFetch pins DNS resolution at the actual
 * connection layer to the address validated at preflight.
 *
 * The CRITICAL DNS rebinding finding said the preflight DNS lookup
 * (in checkAllowed) and the connect-time DNS lookup (inside undici
 * under globalThis.fetch) were independent, so an attacker controlling
 * authoritative DNS could return a public IP at preflight and 127.0.0.1
 * at connect time. The fix wraps the actual fetch in `pinDns(...)`,
 * which intercepts `dns.lookup` for the validated hostname so that
 * undici receives the pre-validated IP.
 *
 * To prove the fix engages, we install a stub `globalThis.fetch` that —
 * inside its body — calls `dns.lookup` for the same hostname. If pinning
 * is active, the lookup must return the pinned IP, NOT what real DNS
 * (or the test default) would return.
 */
import dns from "node:dns";
import { afterEach, describe, expect, it } from "vitest";
import { createSecureFetch } from "./fetch.js";

const originalFetch: typeof globalThis.fetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function lookupAll(
  hostname: string,
): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses as { address: string; family: number }[]);
    });
  });
}

describe("secureFetch DNS pinning", () => {
  it("pins dns.lookup inside fetch to the address validated at preflight", async () => {
    const seen: { address: string; family: number }[][] = [];
    globalThis.fetch = (async () => {
      // Connect-time resolution path: this is what undici would do.
      // With pinning, the lookup must return the validated address even
      // though no real DNS server resolves "attacker.example".
      seen.push(await lookupAll("attacker.example"));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: true,
      // Preflight returns a public IP (passes private-range check).
      // Pinning must use this exact address at connect time.
      _dnsResolve: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    const result = await secureFetch("https://attacker.example/path");
    expect(result.status).toBe(200);
    expect(seen).toEqual([[{ address: "93.184.216.34", family: 4 }]]);
    // sanity check: 93.184.216.34 is example.com — definitely not what real
    // DNS would return for "attacker.example", proving pinning is engaged.
  });

  it("does not pin when denyPrivateRanges is off (no preflight DNS validation)", async () => {
    let lookupErr: NodeJS.ErrnoException | null = null;
    globalThis.fetch = (async () => {
      // No pinning context — dns.lookup of an invalid host should
      // fall through to the real resolver and produce ENOTFOUND.
      try {
        await lookupAll("definitely-not-a-real-host.invalid");
      } catch (e) {
        lookupErr = e as NodeJS.ErrnoException;
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const secureFetch = createSecureFetch({
      dangerouslyAllowFullInternetAccess: true,
      denyPrivateRanges: false,
    });

    const result = await secureFetch(
      "https://definitely-not-a-real-host.invalid/x",
    );
    expect(result.status).toBe(200);
    expect(lookupErr).not.toBeNull();
    expect(lookupErr).toMatchObject({ code: "ENOTFOUND" });
  });

  it("re-pins on redirect to a different host", async () => {
    const seen: { hostname: string; address: string; family: number }[] = [];
    let firstCall = true;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = new URL(typeof url === "string" ? url : url.toString());
      const addrs = await lookupAll(u.hostname);
      seen.push({
        hostname: u.hostname,
        address: addrs[0].address,
        family: addrs[0].family,
      });
      if (firstCall) {
        firstCall = false;
        return new Response("", {
          status: 302,
          headers: { location: "https://second.example/landing" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://first.example", "https://second.example"],
      denyPrivateRanges: true,
      _dnsResolve: async (hostname: string) => {
        if (hostname === "first.example") {
          return [{ address: "8.8.8.8", family: 4 }];
        }
        return [{ address: "1.1.1.1", family: 4 }];
      },
    });

    const result = await secureFetch("https://first.example/start");
    expect(result.status).toBe(200);
    expect(seen).toEqual([
      { hostname: "first.example", address: "8.8.8.8", family: 4 },
      { hostname: "second.example", address: "1.1.1.1", family: 4 },
    ]);
  });
});
