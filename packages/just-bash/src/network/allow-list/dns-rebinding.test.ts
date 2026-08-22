/**
 * DNS rebinding SSRF protection tests
 *
 * Verifies that private/loopback IPs are blocked when denyPrivateRanges is
 * enabled, preventing DNS rebinding attacks.
 *
 * The bespoke implementation exposed a `_dnsResolve` injection seam for
 * faking DNS answers; guarded-fetch resolves DNS internally and does not
 * expose that seam. These tests therefore assert behavior through the
 * public `createSecureFetch` surface:
 *
 * - Private IP literals are blocked by the lexical pre-check (no DNS needed).
 * - `denyPrivateRanges: false` skips all SSRF/DNS checks.
 * - DNS-resolved private IPs, multi-record split-horizon, and fail-closed
 *   on DNS errors are guarded-fetch's responsibility and covered by its own
 *   test suite; the error mapping from GuardedFetchError to just-bash's
 *   domain errors is verified here.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSecureFetch } from "../fetch.js";
import { NetworkAccessDeniedError } from "../types.js";
import {
  createBashEnvAdapter,
  createMockFetch,
  MOCK_SUCCESS_BODY,
  originalFetch,
} from "./shared.js";

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

  describe("blocks private IP literals (lexical pre-check)", () => {
    // These are caught before any DNS resolution, matching the bespoke
    // implementation's lexical check that runs before DNS.
    const cases: Array<[string, string]> = [
      ["https://127.0.0.1/data", "127.0.0.1"],
      ["https://10.0.0.1/data", "10.0.0.1"],
      ["https://192.168.1.1/data", "192.168.1.1"],
      ["https://172.16.0.1/data", "172.16.0.1"],
      ["https://[::1]/data", "[::1]"],
      ["https://localhost/data", "localhost"],
      ["https://169.254.169.254/latest/meta-data", "169.254.169.254"],
    ];

    it.each(cases)("blocks %s without reaching fetch", async (url) => {
      const secureFetch = createSecureFetch({
        dangerouslyAllowFullInternetAccess: true,
        denyPrivateRanges: true,
      });
      const callsBefore = mockFetch.mock.calls.length;
      await expect(secureFetch(url)).rejects.toThrow(NetworkAccessDeniedError);
      await expect(secureFetch(url)).rejects.toThrow(
        "private/loopback IP address blocked",
      );
      expect(mockFetch.mock.calls).toHaveLength(callsBefore);
    });
  });

  describe("denyPrivateRanges=false skips all checks", () => {
    it("allows private IP literals when denyPrivateRanges is off", async () => {
      const secureFetch = createSecureFetch({
        dangerouslyAllowFullInternetAccess: true,
        denyPrivateRanges: false,
      });
      // With denyPrivateRanges=false, even private IPs pass through to the
      // mock fetch (no lexical or DNS check runs).
      const result = await secureFetch("https://127.0.0.1/data");
      expect(result.status).toBe(404); // mock returns 404 for unknown URLs
    });

    it("allows allow-listed URLs without DNS when denyPrivateRanges is off", async () => {
      const env = createBashEnvAdapter({
        network: {
          allowedUrlPrefixes: ["https://api.example.com"],
          denyPrivateRanges: false,
        },
      });
      const result = await env.exec('curl "https://api.example.com/data"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
    });
  });

  describe("guarded-fetch error mapping", () => {
    it("maps host_not_allowed to NetworkAccessDeniedError", async () => {
      const secureFetch = createSecureFetch({
        allowedUrlPrefixes: ["https://api.example.com"],
      });
      // api.example.com is allowed but evil.com is not in the allow-list.
      // guarded-fetch rejects by host_not_allowed; the adapter maps it.
      await expect(secureFetch("https://evil.com/data")).rejects.toThrow(
        NetworkAccessDeniedError,
      );
    });

    it("maps redirect_to_unsafe_host to RedirectNotAllowedError", async () => {
      const secureFetch = createSecureFetch({
        dangerouslyAllowFullInternetAccess: true,
        denyPrivateRanges: true,
      });
      // A redirect to a private IP literal is caught by the adapter's
      // redirect re-check (lexical), producing RedirectNotAllowedError.
      // We can't easily simulate a DNS-resolved private redirect without
      // fake DNS, but the redirect-to-private-literal path is testable.
      // The mock returns a 302 to 127.0.0.1 for this URL.
      global.fetch = vi.fn(
        async () =>
          new Response("", {
            status: 302,
            headers: { location: "https://127.0.0.1/data" },
          }),
      ) as typeof fetch;

      await expect(secureFetch("https://evil.com/start")).rejects.toThrow(
        "Redirect target not in allow-list",
      );

      global.fetch = mockFetch as typeof fetch;
    });
  });

  describe("lexical check runs before any transport", () => {
    it("blocks IP literals without reaching fetch", async () => {
      const callsBefore = mockFetch.mock.calls.length;
      const secureFetch = createSecureFetch({
        dangerouslyAllowFullInternetAccess: true,
        denyPrivateRanges: true,
      });
      await expect(secureFetch("https://127.0.0.1/data")).rejects.toThrow(
        "private/loopback IP address blocked",
      );
      expect(mockFetch.mock.calls).toHaveLength(callsBefore);
    });
  });
});
