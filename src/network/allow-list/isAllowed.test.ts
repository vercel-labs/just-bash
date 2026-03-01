/**
 * Tests for the isAllowed dynamic URL checker function
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { createMockFetch, MOCK_SUCCESS_BODY, originalFetch } from "./shared.js";

describe("isAllowed dynamic URL checker", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeAll(() => {
    mockFetch = createMockFetch();
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("sync isAllowed function", () => {
    it("allows URLs when isAllowed returns true", async () => {
      const env = new Bash({
        network: {
          isAllowed: () => true,
        },
      });

      const result = await env.exec("curl https://api.example.com/data");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
    });

    it("blocks URLs when isAllowed returns false", async () => {
      const env = new Bash({
        network: {
          isAllowed: () => false,
        },
      });

      const result = await env.exec("curl https://api.example.com/data");
      expect(result.exitCode).toBe(7);
      expect(result.stderr).toContain("Network access denied");
    });

    it("receives correct method and url in request object", async () => {
      const isAllowed = vi.fn().mockReturnValue(true);
      const env = new Bash({
        network: {
          isAllowed,
          allowedMethods: ["GET", "POST"],
        },
      });

      await env.exec("curl -X POST https://api.example.com/data");

      expect(isAllowed).toHaveBeenCalledWith({
        method: "POST",
        url: "https://api.example.com/data",
      });
    });

    it("allows based on hostname check", async () => {
      const env = new Bash({
        network: {
          isAllowed: ({ url }) =>
            new URL(url).hostname.endsWith(".example.com"),
        },
      });

      const allowed = await env.exec("curl https://api.example.com/data");
      expect(allowed.exitCode).toBe(0);

      const blocked = await env.exec("curl https://evil.com/data");
      expect(blocked.exitCode).toBe(7);
    });

    it("allows based on method check", async () => {
      const env = new Bash({
        network: {
          isAllowed: ({ method }) => method === "GET",
          allowedMethods: ["GET", "POST"],
        },
      });

      const getResult = await env.exec("curl https://api.example.com/data");
      expect(getResult.exitCode).toBe(0);

      const postResult = await env.exec(
        "curl -X POST https://api.example.com/data",
      );
      expect(postResult.exitCode).toBe(7);
    });
  });

  describe("async isAllowed function", () => {
    it("allows URLs when isAllowed resolves to true", async () => {
      const env = new Bash({
        network: {
          isAllowed: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return true;
          },
        },
      });

      const result = await env.exec("curl https://api.example.com/data");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
    });

    it("blocks URLs when isAllowed resolves to false", async () => {
      const env = new Bash({
        network: {
          isAllowed: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return false;
          },
        },
      });

      const result = await env.exec("curl https://api.example.com/data");
      expect(result.exitCode).toBe(7);
      expect(result.stderr).toContain("Network access denied");
    });

    it("handles async hostname validation", async () => {
      const allowedHosts = new Set(["api.example.com"]);

      const env = new Bash({
        network: {
          isAllowed: async ({ url }) => {
            // Simulate async lookup
            await new Promise((resolve) => setTimeout(resolve, 1));
            const hostname = new URL(url).hostname;
            return allowedHosts.has(hostname);
          },
        },
      });

      const allowed = await env.exec("curl https://api.example.com/data");
      expect(allowed.exitCode).toBe(0);

      const blocked = await env.exec("curl https://evil.com/data");
      expect(blocked.exitCode).toBe(7);
    });
  });

  describe("isAllowed with redirects", () => {
    it("checks redirect targets with isAllowed", async () => {
      mockFetch.mockClear();
      const checkedUrls: string[] = [];

      const env = new Bash({
        network: {
          isAllowed: ({ url }) => {
            checkedUrls.push(url);
            return url.includes("api.example.com");
          },
        },
      });

      // This URL redirects to https://evil.com/data
      const result = await env.exec(
        "curl https://api.example.com/redirect-to-evil",
      );

      // Should fail because redirect target is blocked (exit code 47 for redirect errors)
      expect(result.exitCode).toBe(47);
      expect(result.stderr).toContain("Redirect target not in allow-list");

      // Both URLs should have been checked
      expect(checkedUrls).toContain("https://api.example.com/redirect-to-evil");
      expect(checkedUrls).toContain("https://evil.com/data");
    });

    it("allows redirect chain when all URLs pass isAllowed", async () => {
      mockFetch.mockClear();

      const env = new Bash({
        network: {
          isAllowed: ({ url }) => url.includes("api.example.com"),
        },
      });

      // This URL redirects to https://api.example.com/data
      const result = await env.exec(
        "curl https://api.example.com/redirect-to-allowed",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
    });

    it("checks redirect targets with async isAllowed", async () => {
      mockFetch.mockClear();

      const env = new Bash({
        network: {
          isAllowed: async ({ url }) => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return url.includes("api.example.com");
          },
        },
      });

      // This URL redirects to https://evil.com/data
      const result = await env.exec(
        "curl https://api.example.com/redirect-to-evil",
      );

      // Exit code 47 for redirect errors
      expect(result.exitCode).toBe(47);
      expect(result.stderr).toContain("Redirect target not in allow-list");
    });
  });

  describe("isAllowed precedence", () => {
    it("isAllowed takes precedence over allowedUrlPrefixes", async () => {
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com"],
          isAllowed: () => false, // Block everything
        },
      });

      // Even though URL is in allowedUrlPrefixes, isAllowed blocks it
      const result = await env.exec("curl https://api.example.com/data");
      expect(result.exitCode).toBe(7);
    });

    it("dangerouslyAllowFullInternetAccess bypasses isAllowed", async () => {
      const isAllowed = vi.fn().mockReturnValue(false);
      const env = new Bash({
        network: {
          dangerouslyAllowFullInternetAccess: true,
          isAllowed,
        },
      });

      const result = await env.exec("curl https://api.example.com/data");
      expect(result.exitCode).toBe(0);
      // isAllowed should not be called when dangerouslyAllowFullInternetAccess is true
      expect(isAllowed).not.toHaveBeenCalled();
    });

    it("falls back to allowedUrlPrefixes when isAllowed not provided", async () => {
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com"],
        },
      });

      const allowed = await env.exec("curl https://api.example.com/data");
      expect(allowed.exitCode).toBe(0);

      const blocked = await env.exec("curl https://evil.com/data");
      expect(blocked.exitCode).toBe(7);
    });
  });

  describe("isAllowed error handling", () => {
    it("lets thrown errors bubble up", async () => {
      const env = new Bash({
        network: {
          isAllowed: () => {
            throw new Error("Auth service unavailable");
          },
        },
      });

      const result = await env.exec("curl https://api.example.com/data");
      // Error bubbles up as generic error (exit code 1)
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Auth service unavailable");
    });

    it("lets rejected promises bubble up", async () => {
      const env = new Bash({
        network: {
          isAllowed: async () => {
            throw new Error("Auth service unavailable");
          },
        },
      });

      const result = await env.exec("curl https://api.example.com/data");
      // Error bubbles up as generic error (exit code 1)
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Auth service unavailable");
    });
  });
});
