/**
 * Adversarial tests attempting to bypass allow-list security
 *
 * These tests verify that various URL manipulation techniques
 * cannot be used to access blocked URLs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createBashEnvAdapter,
  createMockFetch,
  expectAllowed,
  expectBlocked,
  MOCK_SUCCESS_BODY,
  originalFetch,
} from "./shared.js";

describe("allow-list bypass attempts", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeAll(() => {
    mockFetch = createMockFetch();
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("hostname confusion attacks", () => {
    it("blocks evil.com disguised with allowed domain as subdomain", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://api.example.com.evil.com/data");
    });

    it("blocks using @ to put allowed domain in username", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // https://api.example.com@evil.com actually connects to evil.com
      await expectBlocked(env, "https://api.example.com@evil.com/data");
    });

    it("blocks using credentials with allowed domain", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://user:pass@evil.com/data");
    });

    it("blocks hostname with trailing dot", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Trailing dot is technically valid DNS but should be treated carefully
      // URL is not normalized, so api.example.com. != api.example.com
      await expectBlocked(
        env,
        "https://api.example.com./data",
        "https://api.example.com./data",
      );
    });

    it("blocks similar-looking domains (typosquatting)", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://api.examp1e.com/data");
      await expectBlocked(env, "https://api.example.co/data");
      await expectBlocked(env, "https://api-example.com/data");
      await expectBlocked(env, "https://apiexample.com/data");
    });
  });

  describe("URL encoding attacks", () => {
    it("blocks URL-encoded hostname", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // %65 = 'e', trying to encode part of hostname
      // URL class doesn't decode percent-encoded hostnames, so blocked as-is
      await expectBlocked(
        env,
        "https://%65vil.com/data",
        "https://%65vil.com/data",
      );
    });

    it("blocks double URL encoding", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // %25 = '%', so %2565 = %65 after first decode
      // URL class doesn't decode percent-encoded hostnames, so blocked as-is
      await expectBlocked(
        env,
        "https://evil%252ecom/data",
        "https://evil%252ecom/data",
      );
    });

    it("blocks URL-encoded slashes in path", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });
      // %2f = '/', trying to bypass path prefix check
      await expectBlocked(env, "https://api.example.com/v1%2f..%2fv2/users");
    });

    it("handles URL-encoded allowed path correctly", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Normal URL encoding in path should still work for allowed URLs
      await expectAllowed(
        env,
        "https://api.example.com/data",
        MOCK_SUCCESS_BODY,
      );
    });
  });

  describe("path traversal attacks", () => {
    it("blocks path traversal to escape prefix", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });
      await expectBlocked(env, "https://api.example.com/v1/../v2/users");
    });

    it("blocks encoded path traversal", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });
      await expectBlocked(env, "https://api.example.com/v1/%2e%2e/v2/users");
    });

    it("handles double-encoded path traversal - encoded dots stay encoded", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });
      // %252e = %2e after single decode, which stays in path as literal %2e
      // The path /v1/%252e%252e/v2/users starts with /v1/ so it's allowed
      // This is correct - the encoded chars are not interpreted as traversal
      const result = await env.exec(
        'curl "https://api.example.com/v1/%252e%252e/v2/users"',
      );
      // Should pass allow-list (path starts with /v1/), returns 404 from mock
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Not Found");
      expect(result.stderr).toBe("");
    });

    it("blocks backslash path traversal", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });
      await expectBlocked(env, "https://api.example.com/v1/..\\v2/users");
    });
  });

  describe("protocol attacks", () => {
    it("blocks file:// protocol", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec('curl "file:///etc/passwd"');
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it("blocks data: URLs", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec('curl "data:text/plain,evil"');
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it("blocks ftp:// protocol - curl treats unrecognized scheme as hostname", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // curl adds https:// to URLs without recognized scheme, so ftp:// becomes
      // hostname "ftp:" and the URL becomes https://ftp://api.example.com/data
      // This is still blocked because the hostname doesn't match
      const result = await env.exec('curl "ftp://api.example.com/data"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Network access denied");
    });

    it("blocks javascript: URLs", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec('curl "javascript:alert(1)"');
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it("blocks protocol-relative URLs (//)", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Protocol-relative URLs - curl treats // as path, adds https://
      // becomes https:////evil.com/data which is blocked
      const result = await env.exec('curl "//evil.com/data"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https:////evil.com/data\n",
      );
    });
  });

  describe("port manipulation attacks", () => {
    it("blocks non-standard HTTPS port", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://api.example.com:8443/data");
    });

    it("allows explicit port 443 when default port is allowed", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Port 443 is the default HTTPS port, so https://host:443 should match https://host
      // The URL class normalizes this, so it should be allowed
      // Mock returns 404 since it's keyed on URL without explicit port
      const result = await env.exec('curl "https://api.example.com:443/data"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Not Found");
      expect(result.stderr).toBe("");
    });

    it("blocks HTTP on port 443", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "http://api.example.com:443/data");
    });

    it("blocks HTTPS on port 80", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://api.example.com:80/data");
    });
  });

  describe("case sensitivity attacks", () => {
    it("blocks uppercase scheme - curl adds https:// prefix", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // curl adds https:// to URLs without recognized scheme
      // HTTPS:// is not recognized as a scheme by curl's URL parser
      // so it becomes https://HTTPS://api.example.com/data
      const result = await env.exec('curl "HTTPS://api.example.com/data"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Network access denied");
    });

    it("handles uppercase hostname - passes allow-list with normalized hostname", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // URL class normalizes hostname to lowercase for allow-list check
      // But fetch is called with original URL, so mock doesn't match
      // This passes the allow-list but returns 404 from mock
      const result = await env.exec('curl "https://API.EXAMPLE.COM/data"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Not Found");
      expect(result.stderr).toBe("");
    });

    it("blocks mixed case evil domain - preserves case in error", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Error message preserves the original URL casing
      await expectBlocked(
        env,
        "https://EVIL.COM/data",
        "https://EVIL.COM/data",
      );
    });
  });

  describe("IPv4/IPv6 attacks", () => {
    it("blocks IPv4 localhost", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://127.0.0.1/data");
    });

    it("blocks IPv4 private ranges", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://192.168.1.1/data");
      await expectBlocked(env, "https://10.0.0.1/data");
      await expectBlocked(env, "https://172.16.0.1/data");
    });

    it("blocks IPv6 localhost", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(env, "https://[::1]/data");
    });

    it("blocks IPv4-mapped IPv6", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // IPv4-mapped IPv6 address for 127.0.0.1
      await expectBlocked(env, "https://[::ffff:127.0.0.1]/data");
    });

    it("blocks decimal IP notation", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // 2130706433 = 127.0.0.1 in decimal
      await expectBlocked(env, "https://2130706433/data");
    });

    it("blocks octal IP notation", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // 0177.0.0.1 = 127.0.0.1 in octal
      await expectBlocked(env, "https://0177.0.0.1/data");
    });

    it("blocks hex IP notation", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // 0x7f000001 = 127.0.0.1 in hex
      await expectBlocked(env, "https://0x7f000001/data");
    });
  });

  describe("special character injection", () => {
    it("blocks null byte injection", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Null byte might truncate URL processing
      const result = await env.exec(
        'curl "https://api.example.com%00.evil.com/data"',
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it("blocks CRLF injection", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec(
        'curl "https://evil.com%0d%0aHost:%20api.example.com/data"',
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it("blocks fragment to hide path", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });
      // Fragment should not bypass path prefix check
      await expectBlocked(env, "https://api.example.com/v2/users#/v1/");
    });

    it("blocks query string manipulation", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });
      // Query string with path should not bypass
      await expectBlocked(env, "https://api.example.com/v2/?path=/v1/users");
    });
  });

  describe("Unicode/IDN attacks", () => {
    it("blocks homoglyph attacks (Cyrillic 'а' vs Latin 'a')", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Using Cyrillic 'а' (U+0430) instead of Latin 'a' (U+0061)
      await expectBlocked(env, "https://аpi.example.com/data");
    });

    it("blocks punycode bypass attempts", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // xn-- is punycode prefix
      await expectBlocked(env, "https://xn--pi-7ba.example.com/data");
    });

    it("blocks URL with BOM", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // UTF-8 BOM before URL
      const result = await env.exec('curl "\ufeffhttps://evil.com/data"');
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    });

    it("blocks zero-width characters in hostname", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Zero-width space (U+200B) in hostname
      await expectBlocked(env, "https://evil\u200B.com/data");
    });
  });

  describe("whitespace and delimiter attacks", () => {
    it("blocks tab in URL", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Tab in URL makes it invalid
      const result = await env.exec('curl "https://evil.com\t/data"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://evil.com\t/data\n",
      );
    });

    it("blocks newline in URL", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Newline in URL - blocked because evil.com is not allowed
      const result = await env.exec('curl "https://evil.com\n/data"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://evil.com\n/data\n",
      );
    });

    it("blocks space-separated URL injection", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Space in URL creates invalid path, returns 404 from mock
      // The key assertion is no evil data leaks
      const result = await env.exec(
        'curl "https://api.example.com/data https://evil.com/steal"',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("Not Found");
      expect(result.stderr).toBe("");
    });
  });

  describe("redirect chain attacks", () => {
    it("blocks open redirect via allowed domain", async () => {
      // Even if allowed domain has an open redirect, we should block
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec(
        'curl "https://api.example.com/redirect-to-evil"',
      );
      expect(result.exitCode).toBe(47);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (47) Redirect target not in allow-list: https://evil.com/data\n",
      );
    });

    it("verifies no data leaks on blocked redirect", async () => {
      mockFetch.mockClear();
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });

      await env.exec('curl "https://api.example.com/redirect-to-evil"');

      // Verify fetch was called for allowed URL but NOT for evil URL
      const calledUrls = mockFetch.mock.calls.map((c) => c[0]);
      expect(calledUrls).toContain("https://api.example.com/redirect-to-evil");
      expect(calledUrls).not.toContain("https://evil.com/data");
    });
  });

  describe("edge case URLs", () => {
    it("blocks empty hostname", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // Empty hostname is blocked
      const result = await env.exec('curl "https:///data"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https:///data\n",
      );
    });

    it("blocks URL with only protocol", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      // URL with only protocol is blocked
      const result = await env.exec('curl "https://"');
      expect(result.exitCode).toBe(7);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://\n",
      );
    });

    it("blocks extremely long hostname", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const longHost = `${"a".repeat(1000)}.evil.com`;
      await expectBlocked(env, `https://${longHost}/data`);
    });

    it("blocks URL with many subdomains", async () => {
      const env = createBashEnvAdapter({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      await expectBlocked(
        env,
        "https://a.b.c.d.e.f.g.api.example.com.evil.com/data",
      );
    });
  });
});
