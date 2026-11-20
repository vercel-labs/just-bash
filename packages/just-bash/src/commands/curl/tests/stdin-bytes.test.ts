import { afterEach, expect, it, vi } from "vitest";
import { Bash } from "../../../Bash.js";
import { bytesFromUint8Array } from "../../../encoding.js";
import { InMemoryFs } from "../../../fs/in-memory-fs/in-memory-fs.js";
import { resolveLimits } from "../../../limits.js";
import { curlCommand } from "../curl.js";

afterEach(() => vi.unstubAllGlobals());

it("supports text and binary stdin request bodies without Buffer", async () => {
  const fetch = vi.fn(async () => ({
    status: 200,
    statusText: "OK",
    headers: Object.create(null),
    body: new TextEncoder().encode("OK"),
    url: "https://api.example.com/",
  }));
  const ctx = {
    fs: new InMemoryFs(),
    cwd: "/",
    env: new Map<string, string>(),
    stdin: bytesFromUint8Array(new Uint8Array([0x80, 0xff])),
    limits: resolveLimits(),
    fetch,
  };
  vi.stubGlobal("Buffer", undefined);
  const textResult = await curlCommand.execute(
    ["-d", "hello=world", "https://api.example.com/"],
    ctx,
  );
  const binaryResult = await curlCommand.execute(
    ["--data-binary", "@-", "-d", "é", "https://api.example.com/"],
    ctx,
  );
  vi.unstubAllGlobals();
  expect(textResult).toMatchObject({ stdout: "OK", stderr: "", exitCode: 0 });
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    "https://api.example.com/",
    expect.objectContaining({ body: "hello=world" }),
  );
  expect(binaryResult).toMatchObject({ stdout: "OK", stderr: "", exitCode: 0 });
  expect(fetch).toHaveBeenLastCalledWith(
    "https://api.example.com/",
    expect.objectContaining({
      body: new Uint8Array([0x80, 0xff, 0x26, 0xc3, 0xa9]),
    }),
  );
});

it("preserves invalid UTF-8 bytes in binary stdin request bodies", async () => {
  const fetch = vi.fn(async () => new Response("OK"));
  vi.stubGlobal("fetch", fetch);
  const bash = new Bash({
    files: { "/payload": new Uint8Array([0x80, 0xff]) },
    network: {
      allowedUrlPrefixes: ["https://api.example.com"],
      allowedMethods: ["POST"],
    },
  });
  const result = await bash.exec(
    "cat /payload | curl --data-binary @- https://api.example.com",
  );
  expect(result).toMatchObject({ stdout: "OK", stderr: "", exitCode: 0 });
  expect(fetch).toHaveBeenCalledWith(
    "https://api.example.com/",
    expect.objectContaining({ body: new Uint8Array([0x80, 0xff]) }),
  );
});

it("consumes stdin once across ordered data references", async () => {
  const fetch = vi.fn(async () => new Response("OK"));
  vi.stubGlobal("fetch", fetch);
  const bash = new Bash({
    network: {
      allowedUrlPrefixes: ["https://api.example.com"],
      allowedMethods: ["POST"],
    },
  });
  const result = await bash.exec("curl -d @- -d @- https://api.example.com", {
    stdin: "abc",
  });
  expect(result).toMatchObject({ stdout: "OK", stderr: "", exitCode: 0 });
  expect(fetch).toHaveBeenCalledWith(
    "https://api.example.com/",
    expect.objectContaining({ body: "abc&" }),
  );
});
