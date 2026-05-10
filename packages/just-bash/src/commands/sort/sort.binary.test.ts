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

  it("preserves UTF-8 leading bytes under -k1f per-key case-fold", async () => {
    // Per-key `f` modifier (no global -f) must also trigger UTF-8 decode.
    // Without it, `.toLowerCase()` on the latin1 byte view mutates the
    // 0xC3 leading byte of every accented character to 0xE3 — silent data
    // corruption distinct from any user-visible error.
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([
          0x42,
          0x0a, // B\n
          0xc3,
          0x89,
          0x0a, // É\n (UTF-8)
          0x41,
          0x0a, // A\n
        ]),
      },
    });
    const r = await env.exec("sort -k1f /data.bin");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("A\nB\nÉ\n");
  });

  it("preserves UTF-8 bytes under -k1d per-key dictionary order", async () => {
    // -d / per-key d strips non-alphanumerics with `[^a-zA-Z0-9\s]` which
    // on a latin1 byte view treats every UTF-8 continuation byte
    // (0x80–0xBF) as non-alphanumeric and deletes it — half-mangling each
    // multibyte character.
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([
          0x42,
          0x0a, // B\n
          0xc3,
          0xa9,
          0x0a, // é\n
          0x41,
          0x0a, // A\n
        ]),
      },
    });
    const r = await env.exec("sort -k1d /data.bin");
    expect(r.exitCode).toBe(0);
    // Sort order under -d is locale-funky in just-bash (only ASCII counts
    // as "alphanumeric" for the strip regex); what we're regressing
    // against is the byte corruption — `é` must round-trip whole, not as
    // a stranded 0xA9 continuation byte missing its 0xC3 leader.
    expect(r.stdout.split("\n").filter(Boolean).sort()).toEqual([
      "A",
      "B",
      "é",
    ]);
  });
});
