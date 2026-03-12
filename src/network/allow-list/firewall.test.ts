/**
 * Tests for firewall header transforms (credentials brokering)
 *
 * Verifies that header transforms are applied at the fetch boundary,
 * firewall headers override user headers, and no leakage on redirects.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSecureFetch } from "../fetch.js";
import type { AllowedUrlEntry } from "../types.js";
import { originalFetch } from "./shared.js";

/** Minimal mock fetch that captures headers and returns 200 */
function createCapturingMock() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const mockFn = vi.fn<typeof fetch>(
    async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = typeof url === "string" ? url : url.toString();
      const headers: Record<string, string> = Object.create(null);
      if (init?.headers) {
        for (const [k, v] of Object.entries(
          init.headers as Record<string, string>,
        )) {
          headers[k] = v;
        }
      }
      calls.push({ url: urlString, headers });
      return new Response("ok", { status: 200 });
    },
  );
  return { mockFn, calls };
}

/** Mock that returns a redirect for a specific URL */
function createRedirectMock(redirectFrom: string, redirectTo: string) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const mockFn = vi.fn<typeof fetch>(
    async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = typeof url === "string" ? url : url.toString();
      const headers: Record<string, string> = Object.create(null);
      if (init?.headers) {
        for (const [k, v] of Object.entries(
          init.headers as Record<string, string>,
        )) {
          headers[k] = v;
        }
      }
      calls.push({ url: urlString, headers });
      if (urlString === redirectFrom) {
        return new Response("", {
          status: 302,
          headers: { location: redirectTo },
        });
      }
      return new Response("ok", { status: 200 });
    },
  );
  return { mockFn, calls };
}

describe("firewall header transforms", () => {
  beforeAll(() => {
    // Prevent real network calls
    global.fetch = vi.fn(() => {
      throw new Error("unexpected real fetch");
    }) as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("injects firewall headers for matching hostname", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://ai-gateway.vercel.sh",
        transform: [{ headers: { Authorization: "Bearer secret-token" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://ai-gateway.vercel.sh/v1/chat");

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe("Bearer secret-token");
  });

  it("preserves non-conflicting user headers", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [{ headers: { Authorization: "Bearer secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://api.example.com/data", {
      headers: { "Content-Type": "application/json", "X-Custom": "value" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].headers["X-Custom"]).toBe("value");
    expect(calls[0].headers.Authorization).toBe("Bearer secret");
  });

  it("firewall headers override user headers with same name (security)", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [{ headers: { Authorization: "Bearer real-secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://api.example.com/data", {
      headers: { Authorization: "Bearer user-injected" },
    });

    expect(calls).toHaveLength(1);
    // Firewall header wins — sandbox cannot substitute credentials
    expect(calls[0].headers.Authorization).toBe("Bearer real-secret");
  });

  it("merges multiple transforms in order", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [
          { headers: { Authorization: "Bearer first", "X-Key": "key1" } },
          { headers: { "X-Extra": "extra", "X-Key": "key2" } },
        ],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://api.example.com/data");

    expect(calls).toHaveLength(1);
    expect(calls[0].headers.Authorization).toBe("Bearer first");
    // Second transform overrides X-Key from first
    expect(calls[0].headers["X-Key"]).toBe("key2");
    expect(calls[0].headers["X-Extra"]).toBe("extra");
  });

  it("no injection for non-matching hosts", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      "https://other-api.com",
      {
        url: "https://secret-api.com",
        transform: [{ headers: { Authorization: "Bearer secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://other-api.com/data", {
      headers: { "X-Custom": "value" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].headers["X-Custom"]).toBe("value");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("redirect to transform host gets headers; redirect away drops them", async () => {
    const { mockFn, calls } = createRedirectMock(
      "https://plain.com/start",
      "https://secret-api.com/target",
    );
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      "https://plain.com",
      {
        url: "https://secret-api.com",
        transform: [{ headers: { Authorization: "Bearer secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://plain.com/start");

    expect(calls).toHaveLength(2);
    // First request (plain.com) — no firewall headers
    expect(calls[0].url).toBe("https://plain.com/start");
    expect(calls[0].headers.Authorization).toBeUndefined();
    // Second request (secret-api.com) — firewall headers injected
    expect(calls[1].url).toBe("https://secret-api.com/target");
    expect(calls[1].headers.Authorization).toBe("Bearer secret");
  });

  it("redirect away from transform host drops firewall headers", async () => {
    const { mockFn, calls } = createRedirectMock(
      "https://secret-api.com/start",
      "https://plain.com/target",
    );
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      "https://plain.com",
      {
        url: "https://secret-api.com",
        transform: [{ headers: { Authorization: "Bearer secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://secret-api.com/start");

    expect(calls).toHaveLength(2);
    // First request — firewall headers present
    expect(calls[0].url).toBe("https://secret-api.com/start");
    expect(calls[0].headers.Authorization).toBe("Bearer secret");
    // Second request (plain.com) — no firewall headers
    expect(calls[1].url).toBe("https://plain.com/target");
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  it("mixed string and object entries work together", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      "https://public-api.com",
      {
        url: "https://private-api.com",
        transform: [{ headers: { "X-Api-Key": "key123" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });

    await secureFetch("https://public-api.com/data");
    await secureFetch("https://private-api.com/data");

    expect(calls).toHaveLength(2);
    // Public API — no firewall headers
    expect(calls[0].headers["X-Api-Key"]).toBeUndefined();
    // Private API — firewall headers injected
    expect(calls[1].headers["X-Api-Key"]).toBe("key123");
  });

  it("invalid object entries throw at construction", () => {
    const entries: AllowedUrlEntry[] = [
      { url: "", transform: [{ headers: { Authorization: "Bearer x" } }] },
    ];

    expect(() => createSecureFetch({ allowedUrlPrefixes: entries })).toThrow(
      "Invalid network allow-list",
    );
  });

  it("object entry without transforms works as plain allow-list entry", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [{ url: "https://api.example.com" }];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://api.example.com/data");

    expect(calls).toHaveLength(1);
    // No firewall headers — object entry without transforms
    expect(Object.keys(calls[0].headers)).toHaveLength(0);
  });
});
