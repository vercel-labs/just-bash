/**
 * Regression tests for curl -o/-O: the response body must not be stringified
 * for stdout when it is only going to be written to a file.
 *
 * Building the stdout string materialises the whole payload as a JS string
 * (UTF-16, so up to ~2x the byte size) on top of the Uint8Array that gets
 * written to the filesystem. On the -o path without -v that string is
 * discarded immediately, so a large download would double-count memory for
 * nothing — enough to OOM a browser renderer on a few hundred MB.
 */

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../../Bash.js";
import * as encoding from "../../../fs/encoding.js";

const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BODY_SIZE = 1024 * 1024;

function stubFetchWithLargeBody(): Uint8Array {
  const body = new Uint8Array(BODY_SIZE).fill(0x61);
  global.fetch = vi.fn(async () => {
    // Fresh copy per request so the assertion below identifies the body by
    // size, not by reference to a shared buffer.
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  }) as typeof fetch;
  return body;
}

/** Counts conversions of a buffer the size of the response body to a string. */
function spyOnBodyStringification(): { count: () => number } {
  const spy = vi.spyOn(encoding, "fromBuffer");
  return {
    count: () =>
      spy.mock.calls.filter(
        (call) =>
          call[0] instanceof Uint8Array && call[0].byteLength === BODY_SIZE,
      ).length,
  };
}

function makeBash(): Bash {
  return new Bash({
    network: { allowedUrlPrefixes: ["https://api.example.com"] },
  });
}

describe("curl -o does not materialise the body for stdout", () => {
  it("writes the file without stringifying the body", async () => {
    stubFetchWithLargeBody();
    const bodyStrings = spyOnBodyStringification();

    const env = makeBash();
    const result = await env.exec(
      "curl -s -o /big.bin https://api.example.com/big",
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(bodyStrings.count()).toBe(0);
  });

  it("does not stringify the body for -O either", async () => {
    stubFetchWithLargeBody();
    const bodyStrings = spyOnBodyStringification();

    const env = makeBash();
    const result = await env.exec("curl -s -O https://api.example.com/big.bin");

    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
    expect(bodyStrings.count()).toBe(0);
  });

  it("still writes the body to stdout when no output file is given", async () => {
    stubFetchWithLargeBody();
    const bodyStrings = spyOnBodyStringification();

    const env = makeBash();
    const result = await env.exec("curl -s https://api.example.com/big");

    expect(result.stdout.length).toBe(BODY_SIZE);
    expect(result.exitCode).toBe(0);
    expect(bodyStrings.count()).toBe(1);
  });

  it("still builds verbose output for -o -v", async () => {
    stubFetchWithLargeBody();

    const env = makeBash();
    const result = await env.exec(
      "curl -s -v -o /big.bin https://api.example.com/big",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("> GET https://api.example.com/big");
    expect(result.stdout).toContain("< HTTP/1.1 200");
    // Verbose keeps the pre-existing behaviour of also echoing the body.
    expect(result.stdout.length).toBeGreaterThan(BODY_SIZE);
  });

  it("still emits the -D - header block on the -o path without stringifying the body", async () => {
    stubFetchWithLargeBody();
    const bodyStrings = spyOnBodyStringification();

    const env = makeBash();
    const result = await env.exec(
      "curl -s -o /big.bin -D - https://api.example.com/big",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("HTTP/1.1 200");
    expect(result.stdout).toContain("content-type: application/octet-stream");
    expect(result.stdout.length).toBeLessThan(BODY_SIZE);
    expect(bodyStrings.count()).toBe(0);
  });

  it("still applies --write-out on the -o path", async () => {
    stubFetchWithLargeBody();
    const bodyStrings = spyOnBodyStringification();

    const env = makeBash();
    const result = await env.exec(
      'curl -s -o /big.bin -w "%{http_code} %{size_download}" https://api.example.com/big',
    );

    expect(result.stdout).toBe(`200 ${BODY_SIZE}`);
    expect(result.exitCode).toBe(0);
    expect(bodyStrings.count()).toBe(0);
  });
});
