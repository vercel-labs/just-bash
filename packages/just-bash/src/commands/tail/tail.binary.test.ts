import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tail with binary files", () => {
  it("should read last n lines from binary file", async () => {
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

    const result = await env.exec("tail -n 2 /binary.bin");
    expect(result.stdout).toBe("L2\nL3\n");
    expect(result.exitCode).toBe(0);
  });

  it("should read last n bytes with -c", async () => {
    const env = new Bash({
      files: {
        "/binary.bin": new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x45]), // ABCDE
      },
    });

    const result = await env.exec("tail -c 3 /binary.bin");
    expect(result.stdout).toBe("CDE");
    expect(result.exitCode).toBe(0);
  });

  it("-c counts bytes, not codepoints, for a UTF-8 file argument", async () => {
    // 文 = E6 96 87 (3 bytes). `tail -c 3` must return exactly the last 3 bytes.
    const env = new Bash();
    await env.exec('printf "中文" > /utf8.txt');

    const result = await env.exec("tail -c 3 /utf8.txt");
    expect(result.stdout).toBe("文");
    expect(result.exitCode).toBe(0);
  });

  it("preserves high bytes when reading from a file argument (no UTF-8 mangling)", async () => {
    // 0xFF is invalid UTF-8; the old fs.readFile path inflated it to U+FFFD.
    const original = new Uint8Array([0x41, 0x42, 0xff, 0x00, 0x80, 0xfe]);
    const env = new Bash({ files: { "/raw.bin": original } });

    await env.exec("tail -c 4 /raw.bin > /out.bin");
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

    await env.exec("tail -v 'café.txt' > /out.bin");
    const out = await env.fs.readFileBuffer("/out.bin");

    const expected = new TextEncoder().encode("==> café.txt <==\nhi\n");
    expect(Array.from(out)).toEqual(Array.from(expected));
  });
});
