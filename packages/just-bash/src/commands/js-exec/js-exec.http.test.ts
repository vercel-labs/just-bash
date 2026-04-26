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

  describe("large JSON API response processing", () => {
    it("should fetch and process 50KB of JSON", async () => {
      // Generate a realistic ~50KB JSON API response: array of user records
      const users = Array.from({ length: 500 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        age: 20 + (i % 50),
        active: i % 3 !== 0,
        score: Math.round((i * 7.3 + 11) % 100),
      }));
      const jsonPayload = JSON.stringify(users);
      // Verify it's roughly 50KB
      expect(jsonPayload.length).toBeGreaterThan(40_000);
      expect(jsonPayload.length).toBeLessThan(70_000);

      mockFetch.mockResolvedValueOnce(
        new Response(jsonPayload, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const env = new Bash({
        javascript: true,
        network: { allowedUrlPrefixes: ["https://api.example.com/"] },
      });

      // Realistic data processing: filter active users, compute average score
      const result = await env.exec(
        `js-exec -c "
          var r = await fetch('https://api.example.com/users');
          var users = await r.json();
          var active = users.filter(function(u) { return u.active; });
          var avgScore = active.reduce(function(s, u) { return s + u.score; }, 0) / active.length;
          var oldest = active.reduce(function(a, b) { return a.age > b.age ? a : b; });
          console.log('total:', users.length);
          console.log('active:', active.length);
          console.log('avgScore:', Math.round(avgScore));
          console.log('oldest:', oldest.name, oldest.age);
        "`,
      );

      // Compute expected values
      const activeUsers = users.filter((u) => u.active);
      const expectedAvg = Math.round(
        activeUsers.reduce((s, u) => s + u.score, 0) / activeUsers.length,
      );
      const expectedOldest = activeUsers.reduce((a, b) =>
        a.age > b.age ? a : b,
      );

      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(
        `total: 500\nactive: ${activeUsers.length}\navgScore: ${expectedAvg}\noldest: ${expectedOldest.name} ${expectedOldest.age}\n`,
      );
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
