import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("gzip security hardening", () => {
  it("does not treat a stored gzip filename as an output path", async () => {
    const env = new Bash();
    const compressed = gzipSync("safe payload");
    const header = Buffer.from(compressed.subarray(0, 10));
    header[3] |= 0x08; // FNAME
    const hostile = Buffer.concat([
      header,
      Buffer.from("/escape\0", "latin1"),
      compressed.subarray(10),
    ]);
    await env.fs.writeFile("/archive.gz", hostile);

    const result = await env.exec("gunzip -N /archive.gz");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await env.readFile("/archive")).toBe("safe payload");
    expect(await env.fs.exists("/escape")).toBe(false);
  });

  it("handles large gunzip -c output without stack overflow", async () => {
    const env = new Bash();
    const bigContent = "A".repeat(200000);
    await env.writeFile("/big.txt", bigContent);
    await env.exec("gzip /big.txt");

    const result = await env.exec("gunzip -c /big.txt.gz");

    expect(result.stdout).toBe(bigContent);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("enforces decompressed output limit for file extraction", async () => {
    const env = new Bash({
      executionLimits: {
        maxOutputSize: 128,
      },
    });
    await env.writeFile("/payload.txt", "X".repeat(200));
    await env.exec("gzip /payload.txt");

    const result = await env.exec("gunzip /payload.txt.gz");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "gunzip: /payload.txt.gz: decompressed data exceeds limit (128 bytes)\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await env.fs.exists("/payload.txt")).toBe(false);
  });

  it("enforces decompressed output limit for stdin input", async () => {
    const env = new Bash({
      executionLimits: {
        maxOutputSize: 128,
      },
    });
    await env.writeFile("/payload.txt", "Y".repeat(200));
    await env.exec("gzip /payload.txt");
    const compressed = await env.fs.readFileBuffer("/payload.txt.gz");

    const result = await env.exec("gunzip -c", {
      stdin: Buffer.from(compressed).toString("latin1"),
      // Already a latin1 byte buffer — opt out of the default text-mode
      // UTF-8 encoding so the gzip bytes reach the command verbatim.
      stdinKind: "bytes",
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "gunzip: stdin: decompressed data exceeds limit (128 bytes)\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("reserves a file read before allocating it under a tiny live-byte limit", async () => {
    const env = new Bash({
      files: { "/payload": "x".repeat(65) },
      executionLimits: { maxInputBytes: 1_000, maxLiveBytes: 64 },
    });

    const result = await env.exec("gzip -c /payload");

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /gzip: live byte limit exceeded \(64 bytes\)/,
    );
  });
});
