import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sort with binary content", () => {
  it("should sort lines containing binary-safe content", async () => {
    const env = new Bash({
      files: {
        "/data.txt": new Uint8Array([
          0x63,
          0x0a, // c\n
          0x61,
          0x0a, // a\n
          0x62,
          0x0a, // b\n
        ]),
      },
    });

    const result = await env.exec("sort /data.txt");
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.exitCode).toBe(0);
  });

  it("preserves UTF-8 leading bytes under -f case-fold", async () => {
    // 0xC3 0x89 is "É" in UTF-8. A naive `.toLowerCase()` on the latin1
    // view would turn 0xC3 (Ã) into 0xE3 (ã) — silently mutating the
    // leading byte of every accented Latin character. Verify both lines
    // round-trip unchanged when sorting a binary file with -f.
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([
          0x41,
          0x0a, // A\n
          0xc3,
          0x89,
          0x0a, // É\n (UTF-8)
        ]),
      },
    });
    const r = await env.exec("sort -f /data.bin");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("A\nÉ\n");
  });
});
