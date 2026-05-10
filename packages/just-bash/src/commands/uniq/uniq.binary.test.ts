import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("uniq with binary content", () => {
  it("should dedupe lines in binary file", async () => {
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([
          0x61,
          0x0a, // a\n
          0x61,
          0x0a, // a\n
          0x62,
          0x0a, // b\n
        ]),
      },
    });

    const result = await env.exec("uniq /data.bin");
    expect(result.stdout).toBe("a\nb\n");
    expect(result.exitCode).toBe(0);
  });

  it("preserves UTF-8 leading bytes under -i case-fold", async () => {
    // 0xC3 0xA9 is "é" in UTF-8; 0xC3 0x89 is "É". A naive byte-level
    // `.toLowerCase()` would mutate 0xC3 → 0xE3, corrupting the bytes.
    // The two lines case-fold equal, so they collapse to one line whose
    // bytes match the first occurrence verbatim.
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([
          0xc3,
          0x89,
          0x0a, // É\n
          0xc3,
          0xa9,
          0x0a, // é\n
        ]),
      },
    });
    const r = await env.exec("uniq -i /data.bin");
    expect(r.exitCode).toBe(0);
    // First line wins on collapse — bytes intact, no 0xE3 mutation.
    expect(r.stdout).toBe("É\n");
  });
});
