import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Bash } from "../../Bash.js";

// Mock fetch to avoid real network requests
const originalFetch = global.fetch;
const mockFetch = vi.fn();

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  mockFetch.mockClear();
});

describe("js-exec http operations", () => {
  describe("network access denied", () => {
    it("should error when network is not configured", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "fetch('http://example.com').then(function(r) { console.log('status: ' + r.status); }, function(e) { console.log('error: ' + e.message); })"`,
      );
      expect(result.stdout).toContain("error:");
      expect(result.stdout).toContain("Network access not configured");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("successful requests", () => {
    it("should make a GET request and return Response", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"key": "value"}', {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
        }),
      );
      const env = new Bash({
        javascript: true,
        network: { allowedUrlPrefixes: ["https://api.example.com/"] },
      });
      const result = await env.exec(
        `js-exec -c "fetch('https://api.example.com/data').then(function(r) { console.log(r.status, r.ok, r.constructor.name); })"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("200 true Response\n");
      expect(result.exitCode).toBe(0);
    });

    it("should parse JSON via response.json()", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('{"name": "alice", "age": 30}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const env = new Bash({
        javascript: true,
        network: { allowedUrlPrefixes: ["https://api.example.com/"] },
      });
      const result = await env.exec(
        `js-exec -c "var r = await fetch('https://api.example.com/user'); var d = await r.json(); console.log(d.name, d.age)"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("alice 30\n");
      expect(result.exitCode).toBe(0);
    });

    it("should get text via response.text()", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Hello World", { status: 200 }),
      );
      const env = new Bash({
        javascript: true,
        network: { allowedUrlPrefixes: ["https://example.com/"] },
      });
      const result = await env.exec(
        `js-exec -c "var r = await fetch('https://example.com/'); var t = await r.text(); console.log(t)"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("Hello World\n");
      expect(result.exitCode).toBe(0);
    });

    it("should expose response headers via Headers class", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("body", {
          status: 200,
          headers: { "X-Custom": "test-value", "Content-Type": "text/plain" },
        }),
      );
      const env = new Bash({
        javascript: true,
        network: { allowedUrlPrefixes: ["https://api.example.com/"] },
      });
      const result = await env.exec(
        `js-exec -c "var r = await fetch('https://api.example.com/data'); console.log(r.headers.get('x-custom'), r.headers.get('content-type'))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("test-value text/plain\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle non-ok responses", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      );
      const env = new Bash({
        javascript: true,
        network: { allowedUrlPrefixes: ["https://api.example.com/"] },
      });
      const result = await env.exec(
        `js-exec -c "var r = await fetch('https://api.example.com/missing'); console.log(r.status, r.ok, r.statusText)"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("404 false Not Found\n");
      expect(result.exitCode).toBe(0);
    });

    it("should send POST with body", async () => {
      mockFetch.mockImplementationOnce(async (_url, options) => {
        return new Response(JSON.stringify({ received: options?.body }), {
          status: 200,
        });
      });
      const env = new Bash({
        javascript: true,
        network: {
          allowedUrlPrefixes: ["https://api.example.com/"],
          allowedMethods: ["GET", "POST"],
        },
      });
      const result = await env.exec(
        `js-exec -c "var r = await fetch('https://api.example.com/post', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: 'val'})}); var d = await r.json(); console.log(d.received)"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe('{"key":"val"}\n');
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Web API classes", () => {
    it("should support URL class", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var u = new URL('https://example.com:8080/path?q=1&r=2#hash'); console.log(u.hostname, u.port, u.pathname, u.searchParams.get('q'), u.hash)"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("example.com 8080 /path 1 #hash\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Headers class", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var h = new Headers({'Content-Type': 'application/json'}); h.append('Accept', 'text/html'); console.log(h.get('content-type'), h.has('accept'))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("application/json true\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Response static methods", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var r = Response.json({ok: true}); r.json().then(function(d) { console.log(d.ok, r.status, r.headers.get('content-type')); })"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("true 200 application/json\n");
      expect(result.exitCode).toBe(0);
    });

    it("should support Request class", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "var req = new Request('https://example.com', {method: 'POST', headers: {'X-Test': 'yes'}}); console.log(req.method, req.url, req.headers.get('x-test'))"`,
      );
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("POST https://example.com yes\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
