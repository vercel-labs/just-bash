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

/** Extract headers from RequestInit into a plain record */
function extractHeaders(init?: RequestInit): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  if (!init?.headers) return result;
  // Handle both Headers instances and plain objects
  const h = init.headers;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      result[k] = v;
    });
  } else {
    for (const [k, v] of Object.entries(h as Record<string, string>)) {
      result[k] = v;
    }
  }
  return result;
}

/** Minimal mock fetch that captures headers and returns 200 */
function createCapturingMock() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const mockFn = vi.fn<typeof fetch>(
    async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = typeof url === "string" ? url : url.toString();
      calls.push({ url: urlString, headers: extractHeaders(init) });
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
      calls.push({ url: urlString, headers: extractHeaders(init) });
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

  it("injects firewall headers for matching URL prefix", async () => {
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
    expect(calls[0].headers.authorization).toBe("Bearer secret-token");
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
    expect(calls[0].headers["content-type"]).toBe("application/json");
    expect(calls[0].headers["x-custom"]).toBe("value");
    expect(calls[0].headers.authorization).toBe("Bearer secret");
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
    expect(calls[0].headers.authorization).toBe("Bearer real-secret");
  });

  it("prevents case-insensitive header bypass (security)", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [{ headers: { Authorization: "Bearer real-secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    // User attempts bypass using different casing
    await secureFetch("https://api.example.com/data", {
      headers: { authorization: "Bearer user-injected" },
    });

    expect(calls).toHaveLength(1);
    // Firewall header must still win regardless of header name casing
    expect(calls[0].headers.authorization).toBe("Bearer real-secret");
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
    expect(calls[0].headers.authorization).toBe("Bearer first");
    // Later transform overrides earlier for same header name
    expect(calls[0].headers["x-key"]).toBe("key2");
    expect(calls[0].headers["x-extra"]).toBe("extra");
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
    // No firewall headers for this host, so user headers pass through with original casing
    expect(calls[0].headers["X-Custom"]).toBe("value");
    expect(calls[0].headers.authorization).toBeUndefined();
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
    expect(calls[0].headers.authorization).toBeUndefined();
    // Second request (secret-api.com) — firewall headers injected
    expect(calls[1].url).toBe("https://secret-api.com/target");
    expect(calls[1].headers.authorization).toBe("Bearer secret");
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
    expect(calls[0].headers.authorization).toBe("Bearer secret");
    // Second request (plain.com) — no firewall headers
    expect(calls[1].url).toBe("https://plain.com/target");
    expect(calls[1].headers.authorization).toBeUndefined();
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
    expect(calls[0].headers["x-api-key"]).toBeUndefined();
    // Private API — firewall headers injected
    expect(calls[1].headers["x-api-key"]).toBe("key123");
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

  it("transforms match by URL prefix, not just hostname", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com/v1/",
        transform: [{ headers: { Authorization: "Bearer v1-secret" } }],
      },
      // Same host, different path — no transform
      "https://api.example.com/v2/",
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });

    // /v1/ path — should get firewall headers
    await secureFetch("https://api.example.com/v1/chat");
    // /v2/ path — same host but should NOT get firewall headers
    await secureFetch("https://api.example.com/v2/chat");

    expect(calls).toHaveLength(2);
    expect(calls[0].headers.authorization).toBe("Bearer v1-secret");
    expect(calls[1].headers.authorization).toBeUndefined();
  });

  it("different path prefixes on same host get different transforms", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com/v1/",
        transform: [{ headers: { "X-Api-Key": "key-v1" } }],
      },
      {
        url: "https://api.example.com/v2/",
        transform: [{ headers: { "X-Api-Key": "key-v2" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });

    await secureFetch("https://api.example.com/v1/users");
    await secureFetch("https://api.example.com/v2/users");

    expect(calls).toHaveLength(2);
    expect(calls[0].headers["x-api-key"]).toBe("key-v1");
    expect(calls[1].headers["x-api-key"]).toBe("key-v2");
  });

  it("origin-only transform applies to all paths on that origin", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [{ headers: { Authorization: "Bearer global" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });

    await secureFetch("https://api.example.com/any/path");
    await secureFetch("https://api.example.com/other");

    expect(calls).toHaveLength(2);
    expect(calls[0].headers.authorization).toBe("Bearer global");
    expect(calls[1].headers.authorization).toBe("Bearer global");
  });

  it("later transform overrides earlier for same header name", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [
          { headers: { Authorization: "Bearer first" } },
          { headers: { Authorization: "Bearer second" } },
        ],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://api.example.com/data");

    expect(calls).toHaveLength(1);
    // set() means last value wins
    expect(calls[0].headers.authorization).toBe("Bearer second");
  });

  it("firewall cookies override user cookies", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [{ headers: { Cookie: "api_key=secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    await secureFetch("https://api.example.com/data", {
      headers: { Cookie: "user_session=should_be_replaced" },
    });

    expect(calls).toHaveLength(1);
    // Firewall set() replaces user cookie
    expect(calls[0].headers.cookie).toBe("api_key=secret");
  });

  it("user cookies survive when transform sets unrelated header", async () => {
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
      headers: { Cookie: "session=abc; tracking=xyz" },
    });

    expect(calls).toHaveLength(1);
    // User cookies preserved — transform only touched Authorization
    expect(calls[0].headers.cookie).toBe("session=abc; tracking=xyz");
    expect(calls[0].headers.authorization).toBe("Bearer secret");
  });

  it("multi-value user headers survive unrelated transform", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [{ headers: { Authorization: "Bearer secret" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });
    // Pass Headers with two Cookie entries via append()
    const userHeaders = new Headers();
    userHeaders.append("Cookie", "session=abc");
    userHeaders.append("Cookie", "tracking=xyz");
    await secureFetch("https://api.example.com/data", {
      headers: userHeaders,
    });

    expect(calls).toHaveLength(1);
    // Both cookie values preserved (Headers.append joins with ", ")
    expect(calls[0].headers.cookie).toContain("session=abc");
    expect(calls[0].headers.cookie).toContain("tracking=xyz");
    expect(calls[0].headers.authorization).toBe("Bearer secret");
  });

  it("overlapping prefixes merge headers from all matching entries", async () => {
    const { mockFn, calls } = createCapturingMock();
    global.fetch = mockFn;

    // Origin-wide entry applies to all paths; path-specific adds more headers.
    // A request to /v1/chat matches both — headers from both entries accumulate.
    const entries: AllowedUrlEntry[] = [
      {
        url: "https://api.example.com",
        transform: [{ headers: { "X-Org-Id": "org123" } }],
      },
      {
        url: "https://api.example.com/v1/",
        transform: [{ headers: { Authorization: "Bearer v1-token" } }],
      },
    ];

    const secureFetch = createSecureFetch({ allowedUrlPrefixes: entries });

    // /v1/ matches both entries
    await secureFetch("https://api.example.com/v1/chat");
    // /v2/ matches only the origin-wide entry
    await secureFetch("https://api.example.com/v2/chat");

    expect(calls).toHaveLength(2);
    // /v1/ gets headers from both entries
    expect(calls[0].headers["x-org-id"]).toBe("org123");
    expect(calls[0].headers.authorization).toBe("Bearer v1-token");
    // /v2/ gets only the origin-wide header
    expect(calls[1].headers["x-org-id"]).toBe("org123");
    expect(calls[1].headers.authorization).toBeUndefined();
  });
});
