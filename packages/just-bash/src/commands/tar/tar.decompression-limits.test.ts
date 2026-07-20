import { describe, expect, it } from "vitest";
import {
  createArchive,
  createBzip2CompressedArchive,
  createCompressedArchive,
  parseArchive,
  parseBzip2CompressedArchive,
  parseCompressedArchive,
  parseXzCompressedArchive,
} from "./archive.js";

describe("tar decompression limits", () => {
  it("stops bzip2 decoding before exceeding the configured output ceiling", async () => {
    const compressed = await createBzip2CompressedArchive([
      { name: "payload.txt", content: "A".repeat(4096) },
    ]);

    const result = await parseBzip2CompressedArchive(compressed, {
      maxDecompressedSize: 1024,
    });

    expect(result.entries).toEqual([]);
    expect(result.error).toBe(
      "Decompressed archive too large (max 1024 bytes)",
    );
  });

  it("still parses bzip2 archives below the ceiling", async () => {
    const compressed = await createBzip2CompressedArchive([
      { name: "small.txt", content: "safe" },
    ]);

    const result = await parseBzip2CompressedArchive(compressed, {
      maxDecompressedSize: 4096,
    });

    expect(result.error).toBeUndefined();
    expect(result.entries.map((entry) => entry.name)).toEqual(["small.txt"]);
  });

  it("stops gzip expansion while chunks are being decoded", async () => {
    const compressed = await createCompressedArchive([
      { name: "payload.txt", content: "A".repeat(16_384) },
    ]);

    const result = await parseCompressedArchive(compressed, {
      maxArchiveSize: 1024,
      maxCompressedSize: 1024 * 1024,
    });

    expect(result.entries).toEqual([]);
    expect(result.error).toContain("output exceeds limit (1024 bytes)");
  });

  it("honors cancellation inside the byte-oriented bzip2 decoder", async () => {
    const compressed = await createBzip2CompressedArchive([
      { name: "payload.txt", content: "A".repeat(4096) },
    ]);
    const controller = new AbortController();
    controller.abort();

    const result = await parseBzip2CompressedArchive(compressed, {
      signal: controller.signal,
    });

    expect(result.entries).toEqual([]);
    expect(result.error).toBe("bzip2 archive: operation aborted");
  });

  it("validates every entry before returning any extraction candidates", async () => {
    const archive = await createArchive([
      { name: "safe.txt", content: "safe" },
      { name: "oversized.txt", content: "X".repeat(1024) },
    ]);

    const result = await parseArchive(archive, { maxEntrySize: 100 });

    expect(result.entries).toEqual([]);
    expect(result.error).toBe("Archive entry too large (max 100 bytes)");
  });

  it("does not invoke XZ when native code alone is opted in", async () => {
    const result = await parseXzCompressedArchive(
      new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]),
      {
        allowNativeCodecs: true,
        allowTrustedWholeBufferCodecs: false,
      },
    );

    expect(result.entries).toEqual([]);
    expect(result.error).toContain("disabled by configuration");
  });
});
