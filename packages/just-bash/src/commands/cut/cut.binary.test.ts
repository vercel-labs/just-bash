import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cut with binary content", () => {
  it("should cut fields from binary file", async () => {
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([
          0x61,
          0x3a,
          0x62,
          0x3a,
          0x63,
          0x0a, // a:b:c\n
        ]),
      },
    });

    const result = await env.exec("cut -d: -f2 /data.bin");
    expect(result.stdout).toBe("b\n");
    expect(result.exitCode).toBe(0);
  });

  it("-c slices by codepoint over a UTF-8 binary file", async () => {
    // 漢字 = 6 UTF-8 bytes, 2 codepoints. -c 1-2 must keep both
    // codepoints (not the first 2 of 6 bytes, which would be a broken
    // UTF-8 leader).
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([
          0xe6,
          0xbc,
          0xa2, // 漢
          0xe5,
          0xad,
          0x97, // 字
          0x0a,
        ]),
      },
    });
    const r = await env.exec("cut -c 1-2 /data.bin");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("漢字\n");
  });

  it("-f stays byte-clean over an ASCII-only binary file", async () => {
    // The ASCII baseline — bytes pass through unchanged, no encoding hop.
    const env = new Bash({
      files: { "/data.bin": new Uint8Array([0x61, 0x3a, 0x62, 0x3a, 0x63]) },
    });
    const r = await env.exec("cut -d: -f1,3 /data.bin");
    expect(r.stdout).toBe("a:c\n");
  });
});
