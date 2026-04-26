/**
 * DNS rebinding integration tests with REAL DNS resolution (no mocks).
 *
 * These tests verify that the DNS resolution path in checkAllowed()
 * actually works end-to-end with real dns.lookup calls.
 * Only fetch is mocked (to avoid real HTTP requests).
 */

import { lookup } from "node:dns";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createBashEnvAdapter,
  createMockFetch,
  originalFetch,
} from "./shared.js";

/**
 * Resolve a hostname with real DNS and return addresses.
 */
function realLookupAll(
  hostname: string,
): Promise<{ address: string; family: number }[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

describe("DNS rebinding integration (real DNS)", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeAll(() => {
    mockFetch = createMockFetch();
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("real dns.lookup resolves localhost to loopback", async () => {
    // Verify the real DNS module works and resolves as expected.
    // This proves our ESM import of node:dns is functional.
    const addresses = await realLookupAll("localhost");
    expect(addresses.length).toBeGreaterThan(0);
    const hasLoopback = addresses.some(
      ({ address }) => address === "127.0.0.1" || address === "::1",
    );
    expect(hasLoopback).toBe(true);
  });

  it("allows public domain through real DNS check (if DNS available)", async () => {
    // Try to resolve a real public domain. May fail in sandboxed
    // environments — skip gracefully if so.
    let addresses: { address: string; family: number }[];
    try {
      addresses = await realLookupAll("example.com");
    } catch {
      // DNS unavailable (sandbox/CI) — skip
      return;
    }

    expect(addresses.length).toBeGreaterThan(0);
    // example.com should resolve to a public IP
    for (const { address } of addresses) {
      expect(address).not.toMatch(
        /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/,
      );
      expect(address).not.toBe("::1");
    }

    const env = createBashEnvAdapter({
      network: {
        dangerouslyAllowFullInternetAccess: true,
        denyPrivateRanges: true,
      },
    });

    // Real DNS resolves example.com → public IP → passes DNS check
    // Mock fetch returns 404 for unknown URLs — the key assertion is
    // that the DNS check didn't block it.
    const result = await env.exec('curl "https://example.com/data"');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("ENOTFOUND domain passes DNS check (no rebinding risk)", async () => {
    // When DNS can't resolve a domain, there's no rebinding risk.
    // The request should proceed and fail at the fetch level naturally.
    const env = createBashEnvAdapter({
      network: {
        allowedUrlPrefixes: [
          "https://this-domain-does-not-exist-xyz123.example",
        ],
        denyPrivateRanges: true,
      },
    });

    // DNS returns ENOTFOUND → allowed through → reaches mock fetch → 404
    const result = await env.exec(
      'curl "https://this-domain-does-not-exist-xyz123.example/data"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("denyPrivateRanges + allow-list works with real DNS", async () => {
    // Verify the combination of allow-list + denyPrivateRanges + real DNS
    // doesn't break normal operation. Uses a domain that will ENOTFOUND
    // (passes DNS check) and is in the allow-list.
    const env = createBashEnvAdapter({
      network: {
        allowedUrlPrefixes: ["https://api.example.com"],
        denyPrivateRanges: true,
      },
    });

    // api.example.com likely ENOTFOUND → passes DNS check → allow-list OK
    const result = await env.exec('curl "https://api.example.com/data"');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
