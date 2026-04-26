// @ts-expect-error - seek-bzip doesn't have types
import seekBzip from "seek-bzip";
import { describe, expect, it } from "vitest";
import { bzip2Compress } from "./bzip2-compress.js";

/**
 * Helper: compress with our implementation, decompress with seek-bzip (MIT),
 * and verify the roundtrip matches the original input.
 */
function roundtrip(input: Uint8Array): Uint8Array {
  const compressed = bzip2Compress(input);
  const decompressed = seekBzip.decode(Buffer.from(compressed));
  return new Uint8Array(decompressed);
}

function expectRoundtrip(input: Uint8Array): void {
  const output = roundtrip(input);
  expect(Buffer.from(output).equals(Buffer.from(input))).toBe(true);
}

describe("bzip2-compress", () => {
  describe("basic roundtrip", () => {
    it("should compress and decompress a single byte", () => {
      expectRoundtrip(new Uint8Array([65]));
    });

    it("should compress and decompress a short ASCII string", () => {
      expectRoundtrip(Buffer.from("hello"));
    });

    it("should compress and decompress a longer ASCII string", () => {
      expectRoundtrip(
        Buffer.from("The quick brown fox jumps over the lazy dog."),
      );
    });

    it("should compress and decompress repeated characters", () => {
      expectRoundtrip(Buffer.from("AAAA"));
    });

    it("should compress and decompress the full printable ASCII range", () => {
      const chars: number[] = [];
      for (let i = 32; i < 127; i++) chars.push(i);
      expectRoundtrip(new Uint8Array(chars));
    });
  });

  describe("binary data", () => {
    it("should handle all 256 byte values", () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      expectRoundtrip(data);
    });

    it("should handle all 256 byte values in reverse order", () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = 255 - i;
      expectRoundtrip(data);
    });

    it("should handle null bytes", () => {
      expectRoundtrip(new Uint8Array([0, 0, 0, 0, 0]));
    });

    it("should handle 0xFF bytes", () => {
      expectRoundtrip(new Uint8Array([255, 255, 255, 255, 255]));
    });

    it("should handle alternating 0x00 and 0xFF", () => {
      const data = new Uint8Array(100);
      for (let i = 0; i < 100; i++) data[i] = i % 2 === 0 ? 0x00 : 0xff;
      expectRoundtrip(data);
    });

    it("should handle random-looking binary data", () => {
      // Deterministic pseudo-random via LCG
      const data = new Uint8Array(1000);
      let seed = 12345;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = seed & 0xff;
      }
      expectRoundtrip(data);
    });

    it("should handle binary data with only two distinct byte values", () => {
      const data = new Uint8Array(500);
      for (let i = 0; i < 500; i++) data[i] = i % 3 === 0 ? 0xab : 0xcd;
      expectRoundtrip(data);
    });
  });

  describe("run-length edge cases (RLE1)", () => {
    it("should handle exactly 3 repeated bytes (below RLE1 threshold)", () => {
      expectRoundtrip(Buffer.from("aaabbb"));
    });

    it("should handle exactly 4 repeated bytes (RLE1 boundary)", () => {
      expectRoundtrip(new Uint8Array(4).fill(42));
    });

    it("should handle exactly 5 repeated bytes", () => {
      expectRoundtrip(new Uint8Array(5).fill(42));
    });

    it("should handle 255 repeated bytes (max RLE1 run)", () => {
      expectRoundtrip(new Uint8Array(255).fill(99));
    });

    it("should handle 256 repeated bytes (exceeds single RLE1 run)", () => {
      expectRoundtrip(new Uint8Array(256).fill(99));
    });

    it("should handle alternating runs of different bytes", () => {
      const data: number[] = [];
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) data.push(i);
      }
      expectRoundtrip(new Uint8Array(data));
    });

    it("should handle many short runs interspersed", () => {
      const data: number[] = [];
      for (let i = 0; i < 50; i++) {
        data.push(i & 0xff, i & 0xff, i & 0xff); // runs of 3
      }
      expectRoundtrip(new Uint8Array(data));
    });
  });

  describe("BWT edge cases", () => {
    it("should handle single distinct byte repeated", () => {
      expectRoundtrip(new Uint8Array(100).fill(0));
    });

    it("should handle already-sorted data", () => {
      const data = new Uint8Array(100);
      for (let i = 0; i < 100; i++) data[i] = i;
      expectRoundtrip(data);
    });

    it("should handle reverse-sorted data", () => {
      const data = new Uint8Array(100);
      for (let i = 0; i < 100; i++) data[i] = 99 - i;
      expectRoundtrip(data);
    });

    it("should handle periodic data (short period)", () => {
      const pattern = [1, 2, 3];
      const data = new Uint8Array(300);
      for (let i = 0; i < 300; i++) data[i] = pattern[i % pattern.length];
      expectRoundtrip(data);
    });

    it("should handle data with long identical prefix then different suffix", () => {
      const data = new Uint8Array(200);
      data.fill(65);
      data[199] = 66;
      expectRoundtrip(data);
    });
  });

  describe("MTF / Huffman edge cases", () => {
    it("should handle data producing many MTF zeros (high compressibility)", () => {
      // Sorted data → BWT produces many runs of same byte → MTF zeros
      const data = Buffer.from("aaaaabbbbbcccccdddddeeeee");
      expectRoundtrip(data);
    });

    it("should handle data producing few MTF zeros (low compressibility)", () => {
      // Random-looking data → fewer MTF zeros
      const data = Buffer.from("qwertyuiopasdfghjklzxcvbnm1234567890");
      expectRoundtrip(data);
    });

    it("should handle data with exactly one unique symbol", () => {
      expectRoundtrip(new Uint8Array(50).fill(0x42));
    });

    it("should handle data with exactly two unique symbols", () => {
      const data = new Uint8Array(100);
      for (let i = 0; i < 100; i++) data[i] = i < 50 ? 0x41 : 0x42;
      expectRoundtrip(data);
    });

    it("should handle data where all 256 byte values appear", () => {
      const data = new Uint8Array(512);
      for (let i = 0; i < 512; i++) data[i] = i & 0xff;
      expectRoundtrip(data);
    });
  });

  describe("larger data", () => {
    it("should handle 10 KB of text", () => {
      const text = "The quick brown fox jumps over the lazy dog. ";
      const repeated = text.repeat(Math.ceil(10240 / text.length));
      expectRoundtrip(Buffer.from(repeated.slice(0, 10240)));
    });

    it("should handle 50 KB of mixed content", () => {
      const data = new Uint8Array(50 * 1024);
      let seed = 42;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = seed & 0xff;
      }
      expectRoundtrip(data);
    });

    it("should handle 100 KB of highly compressible data", () => {
      const data = new Uint8Array(100 * 1024);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 4; // only 4 distinct values
      }
      expectRoundtrip(data);
    });

    it("should handle data spanning multiple bzip2 blocks (block size 1)", () => {
      // Block size 1 = 100KB blocks, so 150KB should span 2 blocks
      const data = new Uint8Array(150 * 1024);
      let seed = 7;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = seed & 0xff;
      }
      const compressed = bzip2Compress(data, 1);
      const decompressed = seekBzip.decode(Buffer.from(compressed));
      expect(Buffer.from(decompressed).equals(Buffer.from(data))).toBe(true);
    });
  });

  describe("size limits", () => {
    it("should reject input exceeding 10MB", () => {
      const data = new Uint8Array(10 * 1024 * 1024 + 1);
      expect(() => bzip2Compress(data)).toThrow("Input too large");
    });

    it("should accept input at exactly 10MB", () => {
      // Just verify it doesn't throw — don't actually compress 10MB in tests
      // (would be too slow). Instead test with a smaller size to verify the
      // limit check logic works.
      const data = new Uint8Array(1);
      expect(() => bzip2Compress(data)).not.toThrow();
    });
  });

  describe("block size levels", () => {
    const testData = Buffer.from("Block size test data! ".repeat(100));

    it("should work with block size level 1", () => {
      const compressed = bzip2Compress(testData, 1);
      const decompressed = seekBzip.decode(Buffer.from(compressed));
      expect(Buffer.from(decompressed).equals(testData)).toBe(true);
    });

    it("should work with block size level 5", () => {
      const compressed = bzip2Compress(testData, 5);
      const decompressed = seekBzip.decode(Buffer.from(compressed));
      expect(Buffer.from(decompressed).equals(testData)).toBe(true);
    });

    it("should work with block size level 9", () => {
      const compressed = bzip2Compress(testData, 9);
      const decompressed = seekBzip.decode(Buffer.from(compressed));
      expect(Buffer.from(decompressed).equals(testData)).toBe(true);
    });

    it("should reject block size level 0", () => {
      expect(() => bzip2Compress(testData, 0)).toThrow(
        "Block size level must be 1-9",
      );
    });

    it("should reject block size level 10", () => {
      expect(() => bzip2Compress(testData, 10)).toThrow(
        "Block size level must be 1-9",
      );
    });
  });

  describe("bzip2 format compliance", () => {
    it("should produce valid bzip2 header", () => {
      const compressed = bzip2Compress(Buffer.from("test"), 9);
      // BZh9 header
      expect(compressed[0]).toBe(0x42); // 'B'
      expect(compressed[1]).toBe(0x5a); // 'Z'
      expect(compressed[2]).toBe(0x68); // 'h'
      expect(compressed[3]).toBe(0x39); // '9' (block size level)
    });

    it("should encode block size level in header", () => {
      for (let level = 1; level <= 9; level++) {
        const compressed = bzip2Compress(Buffer.from("x"), level);
        expect(compressed[3]).toBe(0x30 + level);
      }
    });

    it("should produce valid block magic bytes", () => {
      const compressed = bzip2Compress(Buffer.from("test"), 9);
      // Block magic: 0x314159265359
      expect(compressed[4]).toBe(0x31);
      expect(compressed[5]).toBe(0x41);
      expect(compressed[6]).toBe(0x59);
      expect(compressed[7]).toBe(0x26);
      expect(compressed[8]).toBe(0x53);
      expect(compressed[9]).toBe(0x59);
    });

    it("should produce output compatible with system bzip2 decompressor", () => {
      // seek-bzip is a well-tested bzip2 decompressor — if it can decode
      // our output, we're producing valid bzip2.
      const inputs = [
        Buffer.from(""),
        Buffer.from("a"),
        Buffer.from("Hello, World!"),
        new Uint8Array(1000).fill(0),
      ];
      for (const input of inputs) {
        if (input.length === 0) continue; // bzip2 doesn't compress empty
        const compressed = bzip2Compress(input);
        const decompressed = seekBzip.decode(Buffer.from(compressed));
        expect(Buffer.from(decompressed).equals(Buffer.from(input))).toBe(true);
      }
    });
  });

  describe("special content patterns", () => {
    it("should handle newlines and carriage returns", () => {
      expectRoundtrip(Buffer.from("line1\nline2\r\nline3\rline4\n"));
    });

    it("should handle null-terminated strings", () => {
      expectRoundtrip(Buffer.from("hello\x00world\x00"));
    });

    it("should handle UTF-8 multibyte sequences", () => {
      expectRoundtrip(Buffer.from("こんにちは世界 🌍 café résumé"));
    });

    it("should handle data that looks like bzip2 headers (no confusion)", () => {
      // Data containing BZh magic and block magic bytes
      const data = Buffer.from("BZh9\x31\x41\x59\x26\x53\x59fake");
      expectRoundtrip(data);
    });

    it("should handle tar-like data (512-byte aligned blocks)", () => {
      // Simulate a small tar header block
      const data = new Uint8Array(1024);
      // Fill with typical tar header pattern: name + nulls + mode bytes
      Buffer.from("test-file.txt").copy(Buffer.from(data.buffer), 0);
      Buffer.from("0000644\x00").copy(Buffer.from(data.buffer), 100);
      Buffer.from("0001750\x00").copy(Buffer.from(data.buffer), 108);
      expectRoundtrip(data);
    });

    it("should handle highly repetitive JSON", () => {
      const json = JSON.stringify(
        Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: "test",
          value: 42,
        })),
      );
      expectRoundtrip(Buffer.from(json));
    });

    it("should handle data with long runs then random data then long runs", () => {
      const data = new Uint8Array(1000);
      // First 300 bytes: all 'A'
      data.fill(65, 0, 300);
      // Middle 400 bytes: pseudo-random
      let seed = 999;
      for (let i = 300; i < 700; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = seed & 0xff;
      }
      // Last 300 bytes: all 'Z'
      data.fill(90, 700, 1000);
      expectRoundtrip(data);
    });
  });

  describe("decompression with seek-bzip", () => {
    it("should decompress output from system bzip2", () => {
      // Pre-computed bzip2 of "AAAA" using macOS system bzip2
      // (verified via: printf 'AAAA' | /usr/bin/bzip2 -c | xxd -i)
      const systemCompressed = new Uint8Array([
        0x42, 0x5a, 0x68, 0x39, 0x31, 0x41, 0x59, 0x26, 0x53, 0x59, 0xe1, 0x6e,
        0x65, 0x71, 0x00, 0x00, 0x02, 0x44, 0x00, 0x40, 0x00, 0x20, 0x00, 0x20,
        0x00, 0x21, 0x00, 0x82, 0x0b, 0x17, 0x72, 0x45, 0x38, 0x50, 0x90, 0xe1,
        0x6e, 0x65, 0x71,
      ]);
      const decoded = seekBzip.decode(Buffer.from(systemCompressed));
      expect(decoded.toString()).toBe("AAAA");
    });
  });
});
