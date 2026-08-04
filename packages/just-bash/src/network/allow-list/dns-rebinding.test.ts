/**
 * DNS rebinding SSRF protection tests
 *
 * Verifies that domains resolving to private/loopback IPs are blocked
 * when denyPrivateRanges is enabled, preventing DNS rebinding attacks.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSecureFetch } from "../fetch.js";
import type { DnsLookupResult } from "../types.js";
import {
  createBashEnvAdapter,
  createMockFetch,
  expectAllowed,
  expectBlockedDnsFailure,
  expectBlockedDnsPrivate,
  MOCK_SUCCESS_BODY,
  originalFetch,
} from "./shared.js";

/** Create a _dnsResolve that returns fixed addresses */
function fakeResolver(
  addresses: DnsLookupResult[],
): (hostname: string) => Promise<DnsLookupResult[]> {
  return () => Promise.resolve(addresses);
}

/** Create a _dnsResolve that rejects with an error */
function failingResolver(
  code: string,
): (hostname: string) => Promise<DnsLookupResult[]> {
  return () => {
    const err = new Error(`DNS error: ${code}`);
    (err as NodeJS.ErrnoException).code = code;
    return Promise.reject(err);
  };
}

describe("DNS rebinding SSRF protection", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeAll(() => {
    mockFetch = createMockFetch();
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("blocks domains resolving to private IPs", () => {
    it("blocks domain resolving to 127.0.0.1 (loopback)", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([{ address: "127.0.0.1", family: 4 }]),
        },
      });

      await expectBlockedDnsPrivate(env, "https://127.0.0.1.nip.io/data");
    });

    it("blocks domain resolving to 10.x.x.x (private)", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([{ address: "10.0.0.1", family: 4 }]),
        },
      });

      await expectBlockedDnsPrivate(env, "https://internal.example.com/data");
    });

    it("blocks domain resolving to 192.168.x.x (private)", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([{ address: "192.168.1.1", family: 4 }]),
        },
      });

      await expectBlockedDnsPrivate(env, "https://sneaky.lvh.me/data");
    });

    it("blocks domain resolving to 172.16.x.x (private)", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([{ address: "172.16.0.1", family: 4 }]),
        },
      });

      await expectBlockedDnsPrivate(env, "https://rebind.example.com/data");
    });

    it("blocks domain resolving to ::1 (IPv6 loopback)", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([{ address: "::1", family: 6 }]),
        },
      });

      await expectBlockedDnsPrivate(
        env,
        "https://ipv6-rebind.example.com/data",
      );
    });
  });

  describe("blocks if ANY resolved address is private", () => {
    it("blocks when one of multiple addresses is private", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([
            { address: "93.184.216.34", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]),
        },
      });

      await expectBlockedDnsPrivate(
        env,
        "https://multi-a-record.example.com/data",
      );
    });
  });

  describe("allows domains resolving to public IPs", () => {
    it("allows domain resolving to public IP", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([{ address: "93.184.216.34", family: 4 }]),
        },
      });

      await expectAllowed(
        env,
        "https://api.example.com/data",
        MOCK_SUCCESS_BODY,
      );
    });
  });

  describe("fail-closed on unexpected DNS errors", () => {
    it("blocks when DNS resolution fails with unexpected error", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: failingResolver("ETIMEOUT"),
        },
      });

      await expectBlockedDnsFailure(env, "https://timeout.example.com/data");
    });

    it("blocks ENOTFOUND without reaching fetch", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: failingResolver("ENOTFOUND"),
        },
      });

      const callsBefore = mockFetch.mock.calls.length;
      await expectBlockedDnsFailure(env, "https://api.example.com/data");
      expect(mockFetch.mock.calls).toHaveLength(callsBefore);
    });

    it("blocks ENODATA without reaching fetch", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: failingResolver("ENODATA"),
        },
      });

      const callsBefore = mockFetch.mock.calls.length;
      await expectBlockedDnsFailure(env, "https://api.example.com/data");
      expect(mockFetch.mock.calls).toHaveLength(callsBefore);
    });

    it("blocks an empty DNS answer without reaching fetch", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: fakeResolver([]),
        },
      });

      const callsBefore = mockFetch.mock.calls.length;
      const result = await env.exec('curl "https://api.example.com/data"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: DNS resolution returned no addresses for private IP check: https://api.example.com/data\n",
      );
      expect(mockFetch.mock.calls).toHaveLength(callsBefore);
    });

    it.each<DnsLookupResult>([
      { address: "not-an-ip", family: 4 },
      { address: "93.184.216.34", family: 6 },
      { address: "2001:4860:4860::8888", family: 4 },
      { address: "93.184.216.34", family: 0 },
    ])("blocks malformed DNS address metadata: %j", async (answer) => {
      const secureFetch = createSecureFetch({
        dangerouslyAllowFullInternetAccess: true,
        denyPrivateRanges: true,
        _dnsResolve: fakeResolver([answer]),
      });

      const callsBefore = mockFetch.mock.calls.length;
      await expect(secureFetch("https://api.example.com/data")).rejects.toThrow(
        "Network access denied: DNS returned an invalid address for private IP check",
      );
      expect(mockFetch.mock.calls).toHaveLength(callsBefore);
    });
  });

  describe("redirect targets are DNS-checked", () => {
    it("blocks redirect to domain resolving to private IP", async () => {
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: (hostname) => {
            // Initial URL resolves to public IP, redirect target to private
            if (hostname === "evil.com") {
              return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
            }
            return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
          },
        },
      });

      // api.example.com/redirect-to-evil → 302 → evil.com/data
      // evil.com resolves to 127.0.0.1 → blocked
      const result = await env.exec(
        'curl "https://api.example.com/redirect-to-evil"',
      );
      expect(result.exitCode).toBe(47);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Redirect target not in allow-list");
    });
  });

  describe("denyPrivateRanges=false skips DNS check", () => {
    it("allows domain resolving to private IP when denyPrivateRanges is off", async () => {
      const resolver = vi.fn();
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: false,
          _dnsResolve: resolver,
        },
      });

      // With denyPrivateRanges=false, DNS check is skipped entirely
      const result = await env.exec('curl "https://api.example.com/data"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
      expect(resolver).not.toHaveBeenCalled();
    });
  });

  describe("lexical check still runs before DNS", () => {
    it("blocks IP literals without DNS lookup", async () => {
      const resolver = vi.fn();
      const env = createBashEnvAdapter({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          denyPrivateRanges: true,
          _dnsResolve: resolver,
        },
      });

      const result = await env.exec('curl "https://127.0.0.1/data"');
      expect(result.exitCode).toBe(7);
      expect(result.stderr).toContain("private/loopback IP address blocked");
      // Lexical check catches IP literals — no DNS lookup needed
      expect(resolver).not.toHaveBeenCalled();
    });
  });
});
