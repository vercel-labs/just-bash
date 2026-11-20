/**
 * Secure fetch behavior tests
 *
 * guarded-fetch handles DNS pinning internally via a shared guarded dispatcher
 * whose `connect.lookup` re-validates the resolved IP inside the socket connect,
 * closing the DNS-rebinding TOCTOU window. The adapter routes through
 * `globalThis.fetch`, and guarded-fetch passes its guarded dispatcher into
 * `fetchInit.dispatcher` — Node's built-in fetch honors that option, so
 * connect-time IP pinning is preserved in production. Tests mock
 * `globalThis.fetch` to avoid real network calls.
 *
 * These tests verify the observable behavior of the public `createSecureFetch`
 * surface: responses, redirects, timeouts, abort propagation, size limits, and
 * credential stripping on cross-origin redirects.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecureFetch } from "./fetch.js";
import type { AllowedUrl, AllowedUrlEntry } from "./types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(
  responder: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    return responder(u, init ?? {});
  }) as unknown as typeof fetch;
}

describe("secureFetch behavior", () => {
  it("returns a FetchResult with status, headers, and raw body bytes", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response("hello world", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );

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
    globalThis.fetch = mockFetch(async () => {
      calls++;
      if (calls === 1) {
        return new Response("", {
          status: 302,
          headers: { location: "https://example.com/final" },
        });
      }
      return new Response("final", { status: 200 });
    });

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
    });

    const result = await secureFetch("https://example.com/start");
    expect(calls).toBe(2);
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.body)).toBe("final");
    expect(result.url).toBe("https://example.com/final");
    expect(result.redirectChain).toEqual([
      {
        status: 302,
        statusText: "",
        headers: expect.objectContaining({
          location: "https://example.com/final",
        }),
      },
    ]);
  });

  it("respects maxRedirects cap", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://example.com/hop" },
        }),
    );

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
    globalThis.fetch = mockFetch(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );

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
    globalThis.fetch = mockFetch(async (_url, init) => {
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
    });

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      timeoutMs: 30,
    });

    await expect(secureFetch("https://example.com/start")).rejects.toThrow();
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("blocks redirect to disallowed URL", async () => {
    globalThis.fetch = mockFetch(async (u) => {
      if (u === "https://example.com/start") {
        return new Response("", {
          status: 302,
          headers: { location: "https://evil.com/data" },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
    });

    await expect(secureFetch("https://example.com/start")).rejects.toThrow(
      "Redirect target not in allow-list",
    );
  });

  it("returns 3xx response when followRedirects is false", async () => {
    globalThis.fetch = mockFetch(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://example.com/final" },
        }),
    );

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
    globalThis.fetch = mockFetch(
      async () => new Response(bigBody, { status: 200 }),
    );

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      maxResponseSize: 100,
    });

    await expect(secureFetch("https://example.com/data")).rejects.toThrow(
      "Response body too large",
    );
  });

  it("strips Authorization on cross-origin redirect", async () => {
    const seenHeaders: Record<string, string>[] = [];
    globalThis.fetch = mockFetch(async (u, init) => {
      const h: Record<string, string> = {};
      const headers = init.headers;
      if (headers && typeof (headers as Headers).forEach === "function") {
        (headers as Headers).forEach((v: string, k: string) => {
          h[k] = v;
        });
      }
      seenHeaders.push(h);
      if (u === "https://example.com/start") {
        return new Response("", {
          status: 302,
          headers: { location: "https://other.com/data" },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com", "https://other.com"],
      denyPrivateRanges: false,
    });

    await secureFetch("https://example.com/start", {
      headers: { Authorization: "Bearer secret", "X-Custom": "keep" },
    });

    // First hop: both headers present
    expect(seenHeaders[0].authorization).toBe("Bearer secret");
    expect(seenHeaders[0]["x-custom"]).toBe("keep");
    // Second hop (cross-origin): Authorization stripped, X-Custom kept
    expect(seenHeaders[1].authorization).toBeUndefined();
    expect(seenHeaders[1]["x-custom"]).toBe("keep");
  });

  it("changes method to GET on 301/302/303 redirect and drops body", async () => {
    const seenMethods: string[] = [];
    const seenBodies: (string | undefined)[] = [];
    globalThis.fetch = mockFetch(async (u, init) => {
      seenMethods.push(init.method ?? "GET");
      seenBodies.push(init.body as string | undefined);
      if (u === "https://example.com/start") {
        return new Response("", {
          status: 302,
          headers: { location: "https://example.com/final" },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      allowedMethods: ["GET", "HEAD", "POST"],
    });

    await secureFetch("https://example.com/start", {
      method: "POST",
      body: "post-data",
    });

    expect(seenMethods).toEqual(["POST", "GET"]);
    expect(seenBodies).toEqual(["post-data", undefined]);
  });

  /**
   * Records the method and body of every hop for a single redirect.
   */
  async function followOneRedirect(
    status: number,
    method: string,
  ): Promise<{ methods: string[]; bodies: (string | undefined)[] }> {
    const methods: string[] = [];
    const bodies: (string | undefined)[] = [];
    globalThis.fetch = mockFetch(async (u, init) => {
      methods.push(init.method ?? "GET");
      bodies.push(init.body as string | undefined);
      if (u === "https://example.com/start") {
        return new Response("", {
          status,
          headers: { location: "https://example.com/final" },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      allowedMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    });
    await secureFetch("https://example.com/start", {
      method,
      body: "payload",
    });
    return { methods, bodies };
  }

  // The fetch standard rewrites only POST on 301/302; curl does the same.
  // Rewriting PUT/PATCH/DELETE would drop the caller's method and body.
  it.each([
    [301, "PUT"],
    [302, "PUT"],
    [301, "PATCH"],
    [302, "DELETE"],
  ])("preserves %s on a %i redirect", async (status, method) => {
    const { methods, bodies } = await followOneRedirect(status, method);
    expect(methods).toEqual([method, method]);
    expect(bodies).toEqual(["payload", "payload"]);
  });

  it.each([
    "PUT",
    "DELETE",
    "POST",
  ])("rewrites %s to GET on a 303 redirect", async (method) => {
    const { methods, bodies } = await followOneRedirect(303, method);
    expect(methods).toEqual([method, "GET"]);
    expect(bodies).toEqual(["payload", undefined]);
  });

  it("keeps HEAD on a 303 redirect", async () => {
    const { methods } = await followOneRedirect(303, "HEAD");
    expect(methods).toEqual(["HEAD", "HEAD"]);
  });

  it("refuses a redirect whose rewritten method is not allowed", async () => {
    // A POST-only policy must not silently issue the rewritten GET.
    const seenMethods: string[] = [];
    globalThis.fetch = mockFetch(async (u, init) => {
      seenMethods.push(init.method ?? "GET");
      if (u === "https://example.com/start") {
        return new Response("", {
          status: 302,
          headers: { location: "https://example.com/final" },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: ["https://example.com"],
      denyPrivateRanges: false,
      allowedMethods: ["POST"],
    });

    await expect(
      secureFetch("https://example.com/start", {
        method: "POST",
        body: "payload",
      }),
    ).rejects.toThrow("HTTP method 'GET' not allowed. Allowed methods: POST");
    expect(seenMethods).toEqual(["POST"]);
  });

  it.each([
    {
      status: 307,
      source: "",
      target: "/data",
      deniedMethod: "POST",
      allowed: "GET",
    },
    {
      status: 307,
      source: "/start",
      target: "/%64ata",
      deniedMethod: "POST",
      allowed: "",
    },
    {
      status: 307,
      source: "/start",
      target: "/data;v=1",
      deniedMethod: "POST",
      allowed: "",
    },
    {
      status: 307,
      source: "/start",
      target: "/data//item",
      deniedMethod: "POST",
      allowed: "",
    },
    {
      status: 303,
      source: "/start",
      target: "/%64ata",
      deniedMethod: "GET",
      allowed: "",
    },
  ])("rejects a $status redirect to $target before requesting it, in either order", async ({
    status,
    source,
    target,
    deniedMethod,
    allowed,
  }) => {
    const broad: AllowedUrlEntry = {
      url: `https://example.com${source}`,
      methods: ["GET", "POST"],
    };
    const narrow: AllowedUrlEntry = {
      url: "https://example.com/data",
      methods: ["GET"],
    };

    // Check both declaration orders for the source and target policies.
    for (const allowedUrlPrefixes of [
      [broad, narrow],
      [narrow, broad],
    ]) {
      const requested: Array<{ url: string; method: string }> = [];
      globalThis.fetch = mockFetch((u, init) => {
        requested.push({ url: u, method: init.method ?? "GET" });
        if (u === "https://example.com/start") {
          return new Response("", {
            status,
            headers: { location: `https://example.com${target}` },
          });
        }
        return new Response("ok", { status: 200 });
      });

      const secureFetch = createSecureFetch({
        allowedUrlPrefixes,
        denyPrivateRanges: false,
      });

      await expect(
        secureFetch("https://example.com/start", {
          method: "POST",
          body: "payload",
        }),
      ).rejects.toMatchObject({
        name: "MethodNotAllowedError",
        message: `HTTP method '${deniedMethod}' not allowed. Allowed methods: ${allowed}`,
      });

      expect(requested).toEqual([
        { url: "https://example.com/start", method: "POST" },
      ]);
    }
  });

  it.each([
    "restrict",
    "widen",
  ] as const)("%s initial request methods", async (policy) => {
    const broad: AllowedUrlEntry = {
      url: "https://example.com",
      methods: ["GET", "POST"],
    };
    const narrow: AllowedUrlEntry = {
      url: "https://example.com/data",
      methods: policy === "restrict" ? ["GET"] : ["POST"],
    };

    for (const allowedUrlPrefixes of [
      [broad, narrow],
      [narrow, broad],
    ]) {
      const transport = mockFetch(() => new Response("ok"));
      globalThis.fetch = transport;
      const secureFetch = createSecureFetch({
        allowedUrlPrefixes,
        allowedMethods: policy === "restrict" ? ["GET", "POST"] : ["GET"],
        denyPrivateRanges: false,
      });

      const request = secureFetch("https://example.com/data", {
        method: "POST",
      });
      if (policy === "restrict") {
        await expect(request).rejects.toThrow(
          "HTTP method 'POST' not allowed. Allowed methods: GET",
        );
        expect(transport).not.toHaveBeenCalled();
      } else {
        expect((await request).status).toBe(200);
        expect(transport).toHaveBeenCalledTimes(1);
      }
    }
  });

  it.each<AllowedUrlEntry>([
    { url: "https://example.com/data", methods: ["GET"] },
    { url: "https://example.com/data", methods: ["POST"] },
    { url: "https://example.com/data", methods: [] },
    { url: "https://example.com/other", methods: ["GET"] },
  ])("denies ambiguous paths on an origin with path methods %o", async (scoped) => {
    const transport = mockFetch(() => new Response("ok"));
    globalThis.fetch = transport;
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: [
        { url: "https://example.com", methods: ["GET", "POST"] },
        scoped,
      ],
      denyPrivateRanges: false,
    });

    for (const path of [
      "/%64ata",
      "/%6Fther",
      "/data/file%20name",
      "/data;v=1",
      "/data//item",
    ]) {
      for (const method of ["GET", "POST"]) {
        await expect(
          secureFetch(`https://example.com${path}`, { method }),
        ).rejects.toMatchObject({
          name: "MethodNotAllowedError",
          message: `HTTP method '${method}' not allowed. Allowed methods: `,
        });
      }
    }
    expect(transport).not.toHaveBeenCalled();

    for (const path of ["/other", "/other?x=%2f#%25"]) {
      expect((await secureFetch(`https://example.com${path}`)).status).toBe(
        200,
      );
    }
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("rejects an encoded path before URL matching with scoped-only entries", async () => {
    const transport = mockFetch(() => new Response("unexpected"));
    globalThis.fetch = transport;
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: [
        { url: "https://example.com/data", methods: ["GET"] },
      ],
      denyPrivateRanges: false,
    });

    await expect(
      secureFetch("https://example.com/%64ata"),
    ).rejects.toMatchObject({
      name: "MethodNotAllowedError",
      message: "HTTP method 'GET' not allowed. Allowed methods: ",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each<AllowedUrlEntry>([
    "https://example.com/data",
    { url: "https://example.com/data" },
  ])("denies ambiguous paths with origin methods and method-less entry %o", async (scoped) => {
    const transport = mockFetch(() => new Response("ok"));
    globalThis.fetch = transport;
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: [
        scoped,
        { url: "https://example.com", methods: ["POST"] },
        "https://other.example.com",
        "https://other.example.com/data",
        { url: "https://unscoped.example.com", methods: ["POST"] },
        "https://split.example.com",
        "https://split.example.com/read",
        { url: "https://split.example.com/write", methods: ["POST"] },
      ],
      allowedMethods: ["GET"],
      denyPrivateRanges: false,
    });

    for (const path of ["/%64ata", "/data;v=1"]) {
      await expect(
        secureFetch(`https://example.com${path}`, { method: "POST" }),
      ).rejects.toThrow("HTTP method 'POST' not allowed. Allowed methods: ");
    }
    expect(transport).not.toHaveBeenCalled();

    await expect(
      secureFetch("https://example.com/data", { method: "POST" }),
    ).rejects.toThrow("HTTP method 'POST' not allowed. Allowed methods: GET");
    expect((await secureFetch("https://example.com/data")).status).toBe(200);
    expect(
      (await secureFetch("https://example.com/other", { method: "POST" }))
        .status,
    ).toBe(200);
    expect((await secureFetch("https://other.example.com/%64ata")).status).toBe(
      200,
    );
    expect(
      (await secureFetch("https://other.example.com/data//item")).status,
    ).toBe(200);
    expect(
      (await secureFetch("https://other.example.com/data;v=1")).status,
    ).toBe(200);
    expect(
      (
        await secureFetch("https://unscoped.example.com/%64ata", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    await expect(
      secureFetch("https://split.example.com/%72ead"),
    ).rejects.toThrow("HTTP method 'GET' not allowed. Allowed methods: ");
    expect(transport).toHaveBeenCalledTimes(6);
  });

  it("preserves inherited allow-list fields on class instances", async () => {
    class Entry implements AllowedUrl {
      get url() {
        return "https://example.com/data";
      }

      get methods(): NonNullable<AllowedUrl["methods"]> {
        return ["POST"];
      }

      get transform(): NonNullable<AllowedUrl["transform"]> {
        return [{ headers: { "X-Token": "configured" } }];
      }
    }

    const seenHeaders: Array<string | null> = [];
    globalThis.fetch = mockFetch((_url, init) => {
      seenHeaders.push(new Headers(init.headers).get("X-Token"));
      return new Response("ok");
    });
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: [new Entry()],
      allowedMethods: ["GET"],
      denyPrivateRanges: false,
    });

    await expect(secureFetch("https://example.com/data")).rejects.toThrow(
      "HTTP method 'GET' not allowed. Allowed methods: POST",
    );
    expect(
      (
        await secureFetch("https://example.com/data", {
          method: "POST",
          headers: { "X-Token": "untrusted" },
        })
      ).status,
    ).toBe(200);
    expect(seenHeaders).toEqual(["configured"]);
  });

  it("keeps the allow-list policy when the caller mutates its entries", async () => {
    const transport = mockFetch(() => new Response("ok"));
    globalThis.fetch = transport;
    const methods: NonNullable<AllowedUrl["methods"]> = ["GET"];
    const scoped: AllowedUrl = {
      url: "https://example.com/data",
      methods,
    };
    const allowedUrlPrefixes: AllowedUrlEntry[] = [
      "https://example.com",
      scoped,
      "https://other.example.com",
    ];
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes,
      allowedMethods: ["GET", "POST"],
      denyPrivateRanges: false,
    });

    methods.push("POST");
    scoped.methods = ["GET", "POST"];
    await expect(
      secureFetch("https://example.com/data", { method: "POST" }),
    ).rejects.toThrow("HTTP method 'POST' not allowed. Allowed methods: GET");
    await expect(
      secureFetch("https://example.com/%64ata", { method: "POST" }),
    ).rejects.toThrow("HTTP method 'POST' not allowed. Allowed methods: ");
    scoped.url = "https://example.com/changed";
    await expect(
      secureFetch("https://example.com/data", { method: "POST" }),
    ).rejects.toThrow("HTTP method 'POST' not allowed. Allowed methods: GET");
    allowedUrlPrefixes[1] = "https://new.example.com";
    allowedUrlPrefixes.push({
      url: "https://other.example.com/data",
      methods: ["GET"],
    });

    await expect(
      secureFetch("https://example.com/%64ata", { method: "POST" }),
    ).rejects.toThrow("HTTP method 'POST' not allowed. Allowed methods: ");
    await expect(
      secureFetch("https://example.com/data", { method: "POST" }),
    ).rejects.toThrow("HTTP method 'POST' not allowed. Allowed methods: GET");
    expect(
      (
        await secureFetch("https://other.example.com/%64ata", {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect((await secureFetch("https://example.com/other")).status).toBe(200);
    await expect(secureFetch("https://new.example.com/")).rejects.toThrow(
      "Network access denied",
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 307, expectedMethod: "POST" as const, target: "/data" },
    { status: 303, expectedMethod: "GET" as const, target: "/data" },
    { status: 307, expectedMethod: "POST" as const, target: "/other" },
  ])("allows $expectedMethod on a $status redirect to $target", async ({
    status,
    expectedMethod,
    target,
  }) => {
    const requested: Array<{ url: string; method: string }> = [];
    globalThis.fetch = mockFetch((url, init) => {
      requested.push({ url, method: init.method ?? "GET" });
      return url === "https://example.com/start"
        ? new Response("", {
            status,
            headers: { location: `https://example.com${target}` },
          })
        : new Response("ok");
    });
    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: [
        { url: "https://example.com", methods: ["POST"] },
        { url: "https://example.com/start", methods: ["POST"] },
        { url: "https://example.com/data", methods: [expectedMethod] },
      ],
      allowedMethods: ["HEAD"],
      denyPrivateRanges: false,
    });

    expect(
      (await secureFetch("https://example.com/start", { method: "POST" }))
        .status,
    ).toBe(200);
    expect(requested).toEqual([
      { url: "https://example.com/start", method: "POST" },
      { url: `https://example.com${target}`, method: expectedMethod },
    ]);
  });

  it("denies every method when the selected entry lists none", async () => {
    globalThis.fetch = mockFetch(() => new Response("ok", { status: 200 }));

    const secureFetch = createSecureFetch({
      allowedUrlPrefixes: [{ url: "https://example.com", methods: [] }],
      denyPrivateRanges: false,
    });

    await expect(
      secureFetch("https://example.com/data", { method: "GET" }),
    ).rejects.toThrow("HTTP method 'GET' not allowed. Allowed methods: ");
  });
});
