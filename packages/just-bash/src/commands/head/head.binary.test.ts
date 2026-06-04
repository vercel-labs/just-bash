import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("head with binary files", () => {
  it("should read first n lines from binary file", async () => {
    const env = new Bash({
      files: {
        "/binary.bin": new Uint8Array([
          0x4c,
          0x31,
          0x0a, // L1\n
          0x4c,
          0x32,
          0x0a, // L2\n
          0x4c,
          0x33,
          0x0a, // L3\n
        ]),
      },
    });

    const result = await env.exec("head -n 2 /binary.bin");
    expect(result.stdout).toBe("L1\nL2\n");
    expect(result.exitCode).toBe(0);
  });

  it("should read first n bytes with -c", async () => {
    const env = new Bash({
      files: {
        "/binary.bin": new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x45]), // ABCDE
      },
    });

    const result = await env.exec("head -c 3 /binary.bin");
    expect(result.stdout).toBe("ABC");
    expect(result.exitCode).toBe(0);
  });

  it("-c counts bytes, not codepoints, for a UTF-8 file argument", async () => {
    // 中 = E4 B8 AD (3 bytes). `head -c 3` must return exactly those 3 bytes.
    const env = new Bash();
    await env.exec('printf "中文" > /utf8.txt');

    const result = await env.exec("head -c 3 /utf8.txt");
    expect(result.stdout).toBe("中");
    expect(result.exitCode).toBe(0);
  });

  it("preserves high bytes when reading from a file argument (no UTF-8 mangling)", async () => {
    // 0xFF is invalid UTF-8. The old fs.readFile path decoded it to U+FFFD
    // (3 bytes), inflating `head -c 4` output to 12 bytes. It must stay 4.
    const original = new Uint8Array([0xff, 0x00, 0x80, 0xfe, 0x41, 0x42]);
    const env = new Bash({ files: { "/raw.bin": original } });

    await env.exec("head -c 4 /raw.bin > /out.bin");
    const out = await env.fs.readFileBuffer("/out.bin");
    expect(Array.from(out)).toEqual([0xff, 0x00, 0x80, 0xfe]);
  });

  it("writes a non-ASCII filename header as UTF-8, not latin1, on redirect", async () => {
    // The whole stream is marked binary, so the header (which carries the
    // filename) must be UTF-8 encoded to byte-shaped form before mixing it
    // with the raw file bytes. Otherwise `é` (U+00E9) is written as the
    // single latin1 byte 0xE9 instead of UTF-8 0xC3 0xA9.
    const env = new Bash();
    await env.exec("printf 'hi\\n' > 'café.txt'");

    await env.exec("head -v 'café.txt' > /out.bin");
    const out = await env.fs.readFileBuffer("/out.bin");

    const expected = new TextEncoder().encode("==> café.txt <==\nhi\n");
    expect(Array.from(out)).toEqual(Array.from(expected));
  });
});
