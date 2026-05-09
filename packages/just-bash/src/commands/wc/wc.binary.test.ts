import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("wc with binary files", () => {
  it("should count bytes correctly", async () => {
    const env = new Bash({
      files: {
        "/binary.bin": new Uint8Array([0x41, 0x00, 0x42, 0x00, 0x43]),
      },
    });

    const result = await env.exec("wc -c /binary.bin");
    expect(result.stdout).toContain("5");
    expect(result.exitCode).toBe(0);
  });

  it("should count lines with null bytes", async () => {
    const env = new Bash({
      files: {
        "/binary.bin": new Uint8Array([0x41, 0x0a, 0x00, 0x0a, 0x42, 0x0a]),
      },
    });

    const result = await env.exec("wc -l /binary.bin");
    expect(result.stdout).toContain("3");
    expect(result.exitCode).toBe(0);
  });

  it("counts -m as codepoints over a UTF-8 file (bytes vs chars diverge)", async () => {
    // "한글" is 6 UTF-8 bytes / 2 codepoints. -c reports 6, -m reports 2.
    // The asymmetry is the regression net against conflating the two.
    const env = new Bash({
      files: {
        "/utf8.txt": new Uint8Array([
          0xed,
          0x95,
          0x9c, // 한
          0xea,
          0xb8,
          0x80, // 글
        ]),
      },
    });
    const c = await env.exec("wc -c /utf8.txt");
    const m = await env.exec("wc -m /utf8.txt");
    expect(c.stdout.trim().split(/\s+/)[0]).toBe("6");
    expect(m.stdout.trim().split(/\s+/)[0]).toBe("2");
  });

  it("counts -c as raw bytes for a file with non-UTF-8 bytes", async () => {
    // 0xFF / 0xFE are invalid UTF-8 leading bytes; the redirect / read
    // layer maps them to U+FFFD when decoding. -c must still report 5 (the
    // file size), not whatever the replacement chars happen to encode to.
    const env = new Bash({
      files: {
        "/raw.bin": new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe]),
      },
    });
    const r = await env.exec("wc -c /raw.bin");
    expect(r.stdout.trim().split(/\s+/)[0]).toBe("5");
  });
});
