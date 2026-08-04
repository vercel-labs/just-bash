/**
 * Tests for curl timeout options
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Bash } from "../../../Bash.js";

const originalFetch = global.fetch;
let lastSignal: AbortSignal | null | undefined;

const mockFetch = vi.fn(async (_url: string, options?: RequestInit) => {
  lastSignal = options?.signal;
  return new Response('{"ok":true}', {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

beforeAll(() => {
  global.fetch = mockFetch as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe("curl timeouts", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    lastSignal = undefined;
  });

  describe("-m/--max-time", () => {
    it("accepts -m timeout option", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec("curl -m 5 https://api.example.com/test");
      expect(result.exitCode).toBe(0);
      // Request was made with an abort signal
      expect(lastSignal).toBeDefined();
    });

    it("accepts --max-time timeout option", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec(
        "curl --max-time 10 https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
    });

    it("accepts --max-time=value format", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec(
        "curl --max-time=30 https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
    });

    it("accepts decimal timeout values", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec("curl -m 0.5 https://api.example.com/test");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--connect-timeout", () => {
    it("accepts --connect-timeout option", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec(
        "curl --connect-timeout 5 https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
    });

    it("accepts --connect-timeout=value format", async () => {
      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec(
        "curl --connect-timeout=10 https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
    });
  });

  describe("timeout behavior", () => {
    it("reports timeout error on abort", async () => {
      // Create a mock that simulates abort
      const abortingFetch = vi.fn(
        async (_url: string, options?: RequestInit) => {
          if (options?.signal) {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            throw error;
          }
          return new Response('{"ok":true}', { status: 200 });
        },
      );
      global.fetch = abortingFetch as typeof fetch;

      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec("curl -m 1 https://api.example.com/slow");

      expect(result.exitCode).toBe(28); // CURLE_OPERATION_TIMEDOUT
      expect(result.stderr).toContain("aborted");

      // Restore mock
      global.fetch = mockFetch as typeof fetch;
    });

    it("propagates timeout cancellation into the live request", async () => {
      let requestAborted = false;
      let laterEffect = false;
      global.fetch = vi.fn(
        async (_url: string, options?: RequestInit): Promise<Response> =>
          await new Promise((resolve, reject) => {
            const id = setTimeout(() => {
              laterEffect = true;
              resolve(new Response("late"));
            }, 50);
            options?.signal?.addEventListener(
              "abort",
              () => {
                requestAborted = true;
                clearTimeout(id);
                reject(options.signal?.reason);
              },
              { once: true },
            );
          }),
      ) as typeof fetch;

      const env = new Bash({
        network: { allowedUrlPrefixes: ["https://api.example.com"] },
      });
      const result = await env.exec(
        "timeout 0.01 curl https://api.example.com/slow",
      );
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(result).toMatchObject({ exitCode: 124, stdout: "", stderr: "" });
      expect(requestAborted).toBe(true);
      expect(laterEffect).toBe(false);
      global.fetch = mockFetch as typeof fetch;
    });
  });
});
