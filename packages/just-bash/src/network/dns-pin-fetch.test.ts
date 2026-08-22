/**
 * Secure fetch connection-binding behavior tests
 *
 * The bespoke implementation used a request-owned undici Agent to pin the
 * DNS-reviewed address to the actual connection, with `_createConnectionOwner`
 * and `_dnsResolve` injection seams for testing. guarded-fetch handles DNS
 * pinning internally via a shared guarded dispatcher whose `connect.lookup`
 * re-validates the resolved IP inside the socket connect, closing the
 * DNS-rebinding TOCTOU window.
 *
 * These tests verify the observable behavior of the public `createSecureFetch`
 * surface: that responses are returned correctly, redirects are followed with
 * re-validation, timeouts are enforced, and parent abort signals propagate.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecureFetch } from "./fetch.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("secureFetch behavior", () => {
  it("returns a FetchResult with status, headers, and raw body bytes", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("hello world", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    ) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
    });

    const result = await secureFetch("https://example.com/data");

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toBe("text/plain");
    expect(new TextDecoder().decode(result.body)).toBe("hello world");
    expect(result.url).toBe("https://example.com/data");
  });

  it("follows redirects and returns the final response", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response("", {
          status: 302,
          headers: { location: "https://example.com/final" },
        });
      }
      return new Response("final", { status: 200 });
    }) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
    });

    const result = await secureFetch("https://example.com/start");
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.body)).toBe("final");
    expect(result.url).toBe("https://example.com/final");
  });

  it("respects maxRedirects cap", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://example.com/hop" },
        }),
    ) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      maxRedirects: 2,
    });

    await expect(secureFetch("https://example.com/start")).rejects.toThrow(
      "Too many redirects",
    );
  });

  it("propagates parent abort signal", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    }) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
    });

    const pending = secureFetch("https://example.com/slow", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("parent stopped")), 5);

    await expect(pending).rejects.toThrow("parent stopped");
  });

  it("enforces timeout across redirect hops", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (_url, init) => {
      calls++;
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, 50);
        init.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(id);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
      return new Response("", {
        status: 302,
        headers: { location: `/hop-${calls}` },
      });
    }) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      timeoutMs: 30,
    });

    await expect(secureFetch("https://example.com/start")).rejects.toThrow();
    // At least one redirect hop started before the timeout fired.
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("blocks redirect to disallowed URL", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u === "https://example.com/start") {
        return new Response("", {
          status: 302,
          headers: { location: "https://evil.com/data" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
    });

    await expect(secureFetch("https://example.com/start")).rejects.toThrow(
      "Redirect target not in allow-list",
    );
  });

  it("returns 3xx response when followRedirects is false", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://example.com/final" },
        }),
    ) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
    });

    const result = await secureFetch("https://example.com/start", {
      followRedirects: false,
    });
    expect(result.status).toBe(302);
  });

  it("enforces maxResponseSize", async () => {
    const bigBody = "x".repeat(1024);
    globalThis.fetch = vi.fn(
      async () => new Response(bigBody, { status: 200 }),
    ) as typeof fetch;

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      maxResponseSize: 100,
    });

    await expect(secureFetch("https://example.com/data")).rejects.toThrow(
      "Response body too large",
    );
  });
});
