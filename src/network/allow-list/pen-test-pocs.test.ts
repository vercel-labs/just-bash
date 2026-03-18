import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";

const originalFetch = global.fetch;

function installEchoFetch() {
  const mockFetch = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
    const urlString = typeof url === "string" ? url : url.toString();
    return new Response(`FETCH:${urlString}`, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  });

  global.fetch = mockFetch as typeof fetch;
  return mockFetch;
}

describe("network pen-test PoCs", () => {
  it("blocks sibling paths like /v10 when only /v1 is allowed", async () => {
    const mockFetch = installEchoFetch();

    try {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1"] },
      });
      const result = await env.exec('curl "https://api.example.com/v10/admin"');

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://api.example.com/v10/admin\n",
      );
      expect(result.exitCode).toBe(7);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });

  it("blocks encoded separator paths under /v1/", async () => {
    const mockFetch = installEchoFetch();

    try {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com/v1/"] },
      });

      const slashResult = await env.exec(
        'curl "https://api.example.com/v1/%2f..%2fv2/users"',
      );
      const backslashResult = await env.exec(
        'curl "https://api.example.com/v1/%5c..%5cv2/users"',
      );

      expect(slashResult.stdout).toBe("");
      expect(slashResult.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://api.example.com/v1/%2f..%2fv2/users\n",
      );
      expect(slashResult.exitCode).toBe(7);
      expect(backslashResult.stdout).toBe("");
      expect(backslashResult.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://api.example.com/v1/%5c..%5cv2/users\n",
      );
      expect(backslashResult.exitCode).toBe(7);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });

  it("does not resolve DNS for disallowed hosts even when denyPrivateRanges is enabled", async () => {
    const mockFetch = installEchoFetch();
    const resolver = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);

    try {
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com"],
          denyPrivateRanges: true,
          _dnsResolve: resolver,
        },
      });
      const result = await env.exec('curl "https://secret.internal/data"');

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://secret.internal/data\n",
      );
      expect(result.exitCode).toBe(7);
      expect(resolver).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });

  it("does not leak DNS failure state for disallowed hosts", async () => {
    const mockFetch = installEchoFetch();
    const resolver = vi.fn(async () => {
      const error = new Error("DNS timeout");
      (error as NodeJS.ErrnoException).code = "ETIMEOUT";
      throw error;
    });

    try {
      const env = new Bash({
        network: {
          allowedUrlPrefixes: ["https://api.example.com"],
          denyPrivateRanges: true,
          _dnsResolve: resolver,
        },
      });
      const result = await env.exec('curl "https://secret.internal/data"');

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "curl: (7) Network access denied: URL not in allow-list: https://secret.internal/data\n",
      );
      expect(result.exitCode).toBe(7);
      expect(resolver).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    }
  });
});
