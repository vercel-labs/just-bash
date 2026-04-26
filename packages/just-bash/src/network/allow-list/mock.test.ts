/**
 * Tests that verify the mock is working correctly and fetch is only
 * called for allowed URLs
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { createMockFetch, originalFetch } from "./shared.js";

describe("allow-list mock verification", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeAll(() => {
    mockFetch = createMockFetch();
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("never calls fetch for blocked URLs", async () => {
    mockFetch.mockClear();

    const env = new Bash({
      network: { allowedUrlPrefixes: ["https://allowed.com"] },
    });

    await env.exec("curl https://blocked.com/data");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls fetch only for allowed URLs", async () => {
    mockFetch.mockClear();

    const env = new Bash({
      network: { allowedUrlPrefixes: ["https://api.example.com"] },
    });

    await env.exec("curl https://api.example.com/data");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/data");
  });

  it("does not call fetch for multiple blocked URLs", async () => {
    mockFetch.mockClear();

    const env = new Bash({
      network: { allowedUrlPrefixes: ["https://api.example.com"] },
    });

    await env.exec("curl https://evil1.com/data");
    await env.exec("curl https://evil2.com/data");
    await env.exec("curl https://evil3.com/data");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls fetch once per allowed request", async () => {
    mockFetch.mockClear();

    const env = new Bash({
      network: { allowedUrlPrefixes: ["https://api.example.com"] },
    });

    await env.exec("curl https://api.example.com/data");
    await env.exec("curl https://api.example.com/v1/users");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/data");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.example.com/v1/users");
  });

  it("does not call fetch for redirect target when blocked", async () => {
    mockFetch.mockClear();

    const env = new Bash({
      network: { allowedUrlPrefixes: ["https://api.example.com"] },
    });

    await env.exec("curl https://api.example.com/redirect-to-evil");

    // Should call fetch for the initial URL only
    const calledUrls = mockFetch.mock.calls.map((c) => c[0]);
    expect(calledUrls).toContain("https://api.example.com/redirect-to-evil");
    expect(calledUrls).not.toContain("https://evil.com/data");
  });

  it("calls fetch for both URLs in allowed redirect chain", async () => {
    mockFetch.mockClear();

    const env = new Bash({
      network: { allowedUrlPrefixes: ["https://api.example.com"] },
    });

    await env.exec("curl https://api.example.com/redirect-to-allowed");

    // Should call fetch for both URLs in the chain
    const calledUrls = mockFetch.mock.calls.map((c) => c[0]);
    expect(calledUrls).toContain("https://api.example.com/redirect-to-allowed");
    expect(calledUrls).toContain("https://api.example.com/data");
  });
});
