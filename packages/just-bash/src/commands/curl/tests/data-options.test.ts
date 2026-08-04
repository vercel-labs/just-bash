/**
 * Tests for curl data aggregation and -G/--get behavior.
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
let lastRequest: { url: string; options: RequestInit } | null = null;

const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
  lastRequest = { url, options: options ?? {} };
  return new Response("ok", { status: 200 });
});

beforeAll(() => {
  global.fetch = mockFetch as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

function createEnv(files?: Record<string, string>): Bash {
  return new Bash({
    files,
    network: {
      allowedUrlPrefixes: ["https://api.example.com"],
      allowedMethods: ["GET", "POST"],
    },
  });
}

describe("curl data options", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    lastRequest = null;
  });

  it("appends repeated data flags in command-line order", async () => {
    const env = createEnv();
    const result = await env.exec(
      "curl -d 'a=1' --data 'b=2' --data-raw 'c=3' https://api.example.com/post",
    );

    const headers = new Headers(lastRequest?.options.headers as HeadersInit);
    expect(result.exitCode).toBe(0);
    expect(lastRequest).toEqual({
      url: "https://api.example.com/post",
      options: expect.objectContaining({
        method: "POST",
        body: "a=1&b=2&c=3",
      }),
    });
    expect(headers.get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("preserves a user-supplied content type", async () => {
    const env = createEnv();
    const result = await env.exec(
      "curl -H 'Content-Type: text/plain' -d 'hello' https://api.example.com/post",
    );

    const headers = new Headers(lastRequest?.options.headers as HeadersInit);
    expect(result.exitCode).toBe(0);
    expect(headers.get("Content-Type")).toBe("text/plain");
  });

  it("moves ordered data to the URL in -G mode", async () => {
    const env = createEnv();
    const result = await env.exec(
      "curl -G 'https://api.example.com/query?fixed=1#section' -d 'a=1' --data-urlencode 'b=hello world*' -d 'c=3'",
    );

    expect(result.exitCode).toBe(0);
    expect(lastRequest).toEqual({
      url: "https://api.example.com/query?fixed=1&a=1&b=hello+world%2a&c=3#section",
      options: expect.objectContaining({
        method: "GET",
      }),
    });
    expect(lastRequest?.options.body).toBeUndefined();
  });

  it("supports every inline --data-urlencode form", async () => {
    const env = createEnv();

    await env.exec(
      "curl -G https://api.example.com/ --data-urlencode 'name=a b'",
    );
    expect(lastRequest?.url).toBe("https://api.example.com/?name=a+b");

    await env.exec("curl -G https://api.example.com/ --data-urlencode '=a b'");
    expect(lastRequest?.url).toBe("https://api.example.com/?a+b");

    await env.exec("curl -G https://api.example.com/ --data-urlencode 'a b'");
    expect(lastRequest?.url).toBe("https://api.example.com/?a+b");
  });

  it("does not duplicate an existing empty query delimiter", async () => {
    const env = createEnv();

    await env.exec("curl -G 'https://api.example.com/?' -d 'q=1'");
    expect(lastRequest?.url).toBe("https://api.example.com/?q=1");

    await env.exec("curl -G 'https://api.example.com/?fixed=1&' -d 'q=1'");
    expect(lastRequest?.url).toBe("https://api.example.com/?fixed=1&q=1");
  });

  it("keeps an explicit request method regardless of -G ordering", async () => {
    const env = createEnv();

    await env.exec(
      "curl -X POST -G https://api.example.com/ --data-urlencode 'q=1'",
    );
    expect(lastRequest).toEqual({
      url: "https://api.example.com/?q=1",
      options: expect.objectContaining({ method: "POST" }),
    });
    expect(lastRequest?.options.body).toBeUndefined();

    await env.exec(
      "curl -G -X POST https://api.example.com/ --data-urlencode 'q=1'",
    );
    expect(lastRequest).toEqual({
      url: "https://api.example.com/?q=1",
      options: expect.objectContaining({ method: "POST" }),
    });
    expect(lastRequest?.options.body).toBeUndefined();
  });

  it("preserves order when inline and file-backed parts are mixed", async () => {
    const env = createEnv({ "/payload.txt": "a=1\n" });
    const result = await env.exec(
      "curl -d @/payload.txt --data-urlencode 'q=a b*' --data-raw 'c=3' https://api.example.com/post",
    );

    expect(result.exitCode).toBe(0);
    expect(lastRequest?.options.body).toBe("a=1&q=a+b%2a&c=3");
  });
});
