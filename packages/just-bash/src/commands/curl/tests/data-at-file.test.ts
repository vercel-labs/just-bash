/**
 * Tests for `@file` interpretation in curl's --data, --data-binary,
 * --data-urlencode, and --data-raw flags.
 *
 * Behavior parity goals with real curl:
 *   -d @file              → read file; strip CR + LF.
 *   --data @file          → same as -d @file.
 *   --data-binary @file   → read file; preserve newlines.
 *   --data-raw @file      → literal string "@file" (no file read).
 *   --data-urlencode @file       → read file, URL-encode contents.
 *   --data-urlencode name@file   → "name=" + URL-encode(file contents).
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
  return new Response("OK", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
});

beforeAll(() => {
  global.fetch = mockFetch as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

const createEnv = (files: Record<string, string> = {}) =>
  new Bash({
    files,
    network: {
      allowedUrlPrefixes: ["https://api.example.com"],
      allowedMethods: ["GET", "POST", "PUT", "DELETE"],
    },
  });

describe("curl @file interpretation", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    lastRequest = null;
  });

  describe("-d / --data @file", () => {
    it("-d @file reads the file contents as the body", async () => {
      const env = createEnv({ "/payload.json": '{"hello":"world"}' });
      const result = await env.exec(
        "curl -d @/payload.json https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.method).toBe("POST");
      expect(lastRequest?.options.body).toBe('{"hello":"world"}');
    });

    it("--data @file reads the file contents", async () => {
      const env = createEnv({ "/payload.txt": "first=1&second=2" });
      const result = await env.exec(
        "curl --data @/payload.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("first=1&second=2");
    });

    it("--data=@file reads the file contents", async () => {
      const env = createEnv({ "/payload.json": '{"a":1}' });
      const result = await env.exec(
        "curl --data=@/payload.json https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe('{"a":1}');
    });

    it("-d@file (no space) reads the file contents", async () => {
      const env = createEnv({ "/payload.txt": "x=1" });
      const result = await env.exec(
        "curl -d@/payload.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("x=1");
    });

    it("-d @file strips CR and LF from the file contents", async () => {
      const env = createEnv({
        "/payload.txt": "line1\nline2\r\nline3",
      });
      const result = await env.exec(
        "curl -d @/payload.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("line1line2line3");
    });

    it("fails cleanly when the file does not exist", async () => {
      const env = createEnv();
      const result = await env.exec(
        "curl -d @/missing.json https://api.example.com/test",
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/curl/);
    });
  });

  describe("--data-binary @file", () => {
    it("reads the file contents as the body", async () => {
      const env = createEnv({ "/blob.bin": "binary payload contents" });
      const result = await env.exec(
        "curl --data-binary @/blob.bin https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.method).toBe("POST");
      expect(lastRequest?.options.body).toBe("binary payload contents");
    });

    it("preserves newlines in the file (unlike --data)", async () => {
      const env = createEnv({ "/multiline.txt": "line1\nline2\r\nline3" });
      const result = await env.exec(
        "curl --data-binary @/multiline.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("line1\nline2\r\nline3");
    });

    it("supports --data-binary=@file form", async () => {
      const env = createEnv({ "/blob.txt": "hello" });
      const result = await env.exec(
        "curl --data-binary=@/blob.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("hello");
    });
  });

  describe("--data-raw treats @ literally", () => {
    it("does NOT read the file when value starts with @", async () => {
      const env = createEnv({ "/payload.json": '{"a":1}' });
      const result = await env.exec(
        "curl --data-raw @/payload.json https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      // Body is the literal string "@/payload.json", not the file contents.
      expect(lastRequest?.options.body).toBe("@/payload.json");
    });
  });

  describe("--data-urlencode @file", () => {
    it("URL-encodes the file contents when value is @file", async () => {
      const env = createEnv({ "/note.txt": "hello world & friends" });
      const result = await env.exec(
        "curl --data-urlencode @/note.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("hello%20world%20%26%20friends");
    });

    it("URL-encodes the file contents with name when value is name@file", async () => {
      const env = createEnv({ "/note.txt": "value with space" });
      const result = await env.exec(
        "curl --data-urlencode note@/note.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("note=value%20with%20space");
    });

    it("concatenates inline and @file urlencode values with &", async () => {
      const env = createEnv({ "/note.txt": "from file" });
      const result = await env.exec(
        'curl --data-urlencode "a=1" --data-urlencode note@/note.txt https://api.example.com/test',
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("a=1&note=from%20file");
    });

    it("supports --data-urlencode=@file form", async () => {
      const env = createEnv({ "/note.txt": "hi there" });
      const result = await env.exec(
        "curl --data-urlencode=@/note.txt https://api.example.com/test",
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("hi%20there");
    });
  });

  describe("mixed inline + file payloads", () => {
    it("merges -d @file with a trailing --data-urlencode inline", async () => {
      const env = createEnv({ "/payload.txt": "from=file" });
      const result = await env.exec(
        'curl -d @/payload.txt --data-urlencode "x=1" https://api.example.com/test',
      );
      expect(result.exitCode).toBe(0);
      expect(lastRequest?.options.body).toBe("from=file&x=1");
    });
  });
});
