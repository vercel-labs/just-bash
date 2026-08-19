import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";

// A minimal ustar member followed by the two zero blocks that end an archive
function tarArchive(name: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const write = (text: string, offset: number) => {
    for (let i = 0; i < text.length; i++) {
      header[offset + i] = text.charCodeAt(i);
    }
  };
  write(name, 0);
  write("0000644\0", 100);
  write("0000000\0", 108);
  write("0000000\0", 116);
  write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
  write("00000000000\0", 136);
  write("        ", 148);
  write("0", 156);
  write("ustar\0", 257);
  write("00", 263);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);

  const padding = new Uint8Array((512 - (data.length % 512)) % 512);
  const trailer = new Uint8Array(1024);
  const archive = new Uint8Array(
    header.length + data.length + padding.length + trailer.length,
  );
  archive.set(header, 0);
  archive.set(data, header.length);
  archive.set(trailer, header.length + data.length + padding.length);
  return archive;
}

function gzip(data: Uint8Array): Uint8Array {
  return new Uint8Array(gzipSync(data));
}

const plainGzip = gzip(new TextEncoder().encode("hello world\n"));
const tarGzip = gzip(
  tarArchive("payload.bin", new Uint8Array(64 * 1024).fill(0x41)),
);

describe("file gzip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should report gzip compressed data", async () => {
    const env = new Bash();
    await env.fs.writeFile("/tmp/payload.gz", plainGzip);
    const result = await env.exec("file /tmp/payload.gz");
    expect(result.stdout).toBe("/tmp/payload.gz: gzip compressed data\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should report gzip compressed data for an archive member", async () => {
    const env = new Bash();
    await env.fs.writeFile("/tmp/payload.tar.gz", tarGzip);
    const result = await env.exec("file /tmp/payload.tar.gz");
    expect(result.stdout).toBe("/tmp/payload.tar.gz: gzip compressed data\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should report the gzip MIME type with -i", async () => {
    const env = new Bash();
    await env.fs.writeFile("/tmp/payload.gz", plainGzip);
    await env.fs.writeFile("/tmp/payload.tar.gz", tarGzip);
    const result = await env.exec(
      "file -i /tmp/payload.gz /tmp/payload.tar.gz",
    );
    expect(result.stdout).toBe(
      "/tmp/payload.gz: application/gzip\n/tmp/payload.tar.gz: application/gzip\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should not decompress gzip input", async () => {
    const constructed: string[] = [];
    // An identity transform in place of the real thing: a regression fails the
    // recorded-format assertion instead of inflating and hanging the suite
    vi.stubGlobal(
      "DecompressionStream",
      class {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
        constructor(format: string) {
          constructed.push(format);
          const { readable, writable } = new TransformStream<
            Uint8Array,
            Uint8Array
          >();
          this.readable = readable;
          this.writable = writable;
        }
      },
    );

    const env = new Bash();
    await env.fs.writeFile("/tmp/payload.gz", plainGzip);
    await env.fs.writeFile("/tmp/payload.tar.gz", tarGzip);
    const result = await env.exec("file /tmp/payload.gz /tmp/payload.tar.gz");

    expect(constructed).toEqual([]);
    expect(result.stdout).toBe(
      "/tmp/payload.gz: gzip compressed data\n/tmp/payload.tar.gz: gzip compressed data\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should still consult file-type when the compression method is not deflate", async () => {
    const env = new Bash();
    const notGzip = new Uint8Array(plainGzip);
    notGzip[2] = 0x00;
    await env.fs.writeFile("/tmp/method-zero.bin", notGzip);
    const result = await env.exec("file /tmp/method-zero.bin");
    expect(result.stdout).toBe("/tmp/method-zero.bin: UTF-8 Unicode text\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
