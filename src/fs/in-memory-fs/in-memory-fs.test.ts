import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs Buffer and Encoding Support", () => {
  describe("basic Buffer operations", () => {
    it("should write and read Uint8Array", async () => {
      const fs = new InMemoryFs();
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

      await fs.writeFile("/binary.bin", data);
      const result = await fs.readFileBuffer("/binary.bin");

      expect(result).toEqual(data);
    });

    it("should write Uint8Array and read as string", async () => {
      const fs = new InMemoryFs();
      const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

      await fs.writeFile("/test.txt", data);
      const result = await fs.readFile("/test.txt");

      expect(result).toBe("Hello");
    });

    it("should write string and read as Uint8Array", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/test.txt", "Hello");
      const result = await fs.readFileBuffer("/test.txt");

      expect(result).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it("should handle binary data with null bytes", async () => {
      const fs = new InMemoryFs();
      const data = new Uint8Array([0x00, 0x01, 0x00, 0xff, 0x00]);

      await fs.writeFile("/binary.bin", data);
      const result = await fs.readFileBuffer("/binary.bin");

      expect(result).toEqual(data);
    });

    it("should calculate correct size for binary files", async () => {
      const fs = new InMemoryFs();
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);

      await fs.writeFile("/binary.bin", data);
      const stat = await fs.stat("/binary.bin");

      expect(stat.size).toBe(5);
    });
  });

  describe("encoding support", () => {
    it("should write and read with utf8 encoding", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/test.txt", "Hello 世界", "utf8");
      const result = await fs.readFile("/test.txt", "utf8");

      expect(result).toBe("Hello 世界");
    });

    it("should write and read with base64 encoding", async () => {
      const fs = new InMemoryFs();

      // "Hello" in base64 is "SGVsbG8="
      await fs.writeFile("/test.txt", "SGVsbG8=", "base64");
      const result = await fs.readFile("/test.txt", "utf8");

      expect(result).toBe("Hello");
    });

    it("should read as base64", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/test.txt", "Hello");
      const result = await fs.readFile("/test.txt", "base64");

      expect(result).toBe("SGVsbG8=");
    });

    it("should write and read with hex encoding", async () => {
      const fs = new InMemoryFs();

      // "Hello" in hex is "48656c6c6f"
      await fs.writeFile("/test.txt", "48656c6c6f", "hex");
      const result = await fs.readFile("/test.txt", "utf8");

      expect(result).toBe("Hello");
    });

    it("should read as hex", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/test.txt", "Hello");
      const result = await fs.readFile("/test.txt", "hex");

      expect(result).toBe("48656c6c6f");
    });

    it("should write with latin1 encoding", async () => {
      const fs = new InMemoryFs();

      // Latin1 character é is 0xe9
      await fs.writeFile("/test.txt", "café", "latin1");
      const buffer = await fs.readFileBuffer("/test.txt");

      expect(buffer).toEqual(new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    });

    it("should support encoding in options object", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/test.txt", "SGVsbG8=", { encoding: "base64" });
      const result = await fs.readFile("/test.txt", { encoding: "utf8" });

      expect(result).toBe("Hello");
    });
  });

  describe("appendFile with Buffer", () => {
    it("should append Uint8Array to existing file", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/test.txt", "Hello");
      await fs.appendFile(
        "/test.txt",
        new Uint8Array([0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]),
      ); // " World"

      const result = await fs.readFile("/test.txt");
      expect(result).toBe("Hello World");
    });

    it("should append string to file with Buffer content", async () => {
      const fs = new InMemoryFs();
      const initial = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

      await fs.writeFile("/test.txt", initial);
      await fs.appendFile("/test.txt", " World");

      const result = await fs.readFile("/test.txt");
      expect(result).toBe("Hello World");
    });

    it("should append with encoding", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/test.txt", "Hello");
      // " World" in base64 is "IFdvcmxk"
      await fs.appendFile("/test.txt", "IFdvcmxk", "base64");

      const result = await fs.readFile("/test.txt");
      expect(result).toBe("Hello World");
    });
  });

  describe("constructor with Buffer content", () => {
    it("should initialize files with Uint8Array content", async () => {
      const fs = new InMemoryFs({
        "/binary.bin": new Uint8Array([0x00, 0x01, 0x02]),
        "/text.txt": "Hello",
      });

      const binary = await fs.readFileBuffer("/binary.bin");
      const text = await fs.readFile("/text.txt");

      expect(binary).toEqual(new Uint8Array([0x00, 0x01, 0x02]));
      expect(text).toBe("Hello");
    });
  });

  describe("edge cases", () => {
    it("should handle empty Uint8Array", async () => {
      const fs = new InMemoryFs();

      await fs.writeFile("/empty.bin", new Uint8Array(0));
      const result = await fs.readFileBuffer("/empty.bin");

      expect(result).toEqual(new Uint8Array(0));
      expect(result.length).toBe(0);
    });

    it("should handle large binary files", async () => {
      const fs = new InMemoryFs();
      const size = 1024 * 1024; // 1MB
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        data[i] = i % 256;
      }

      await fs.writeFile("/large.bin", data);
      const result = await fs.readFileBuffer("/large.bin");

      expect(result.length).toBe(size);
      expect(result[0]).toBe(0);
      expect(result[255]).toBe(255);
      expect(result[256]).toBe(0);
    });

    it("should preserve binary content through copy", async () => {
      const fs = new InMemoryFs();
      const data = new Uint8Array([0x00, 0xff, 0x00, 0xff]);

      await fs.writeFile("/src.bin", data);
      await fs.cp("/src.bin", "/dst.bin");

      const result = await fs.readFileBuffer("/dst.bin");
      expect(result).toEqual(data);
    });

    it("should follow symlinks for binary files", async () => {
      const fs = new InMemoryFs();
      const data = new Uint8Array([0x48, 0x69]);

      await fs.writeFile("/real.bin", data);
      await fs.symlink("/real.bin", "/link.bin");

      const result = await fs.readFileBuffer("/link.bin");
      expect(result).toEqual(data);
    });
  });
});
