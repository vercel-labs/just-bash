import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tr with binary content", () => {
  it("should translate characters in binary content", async () => {
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([0x61, 0x62, 0x63]), // abc
      },
    });

    const result = await env.exec("cat /data.bin | tr a-z A-Z");
    expect(result.stdout).toBe("ABC");
    expect(result.exitCode).toBe(0);
  });

  it("translates by codepoint when input is UTF-8 binary", async () => {
    // The user's `tr 'é' 'X'` invocation is a real Unicode codepoint,
    // while the input bytes are 0xC3 0xA9 (UTF-8 for é). Without decoding,
    // tr would iterate per-byte and never match the codepoint.
    const env = new Bash({
      files: { "/data.bin": new Uint8Array([0x63, 0xc3, 0xa9, 0x0a]) }, // c, é, \n
    });
    const r = await env.exec("cat /data.bin | tr 'é' 'X'");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("cX\n");
  });

  it("ASCII passthrough doesn't touch high bytes", async () => {
    // tr 'a-z' 'A-Z' must only translate ASCII; the embedded UTF-8 bytes
    // (which are all >0x7F) and any control bytes pass through verbatim.
    const env = new Bash({
      files: {
        "/data.bin": new Uint8Array([0x61, 0xc3, 0xa9, 0x62, 0x00, 0x63]),
      },
    });
    const r = await env.exec("cat /data.bin | tr 'a-z' 'A-Z'");
    expect(r.exitCode).toBe(0);
    // a → A, é stays é, b → B, NUL stays, c → C.
    expect(r.stdout).toBe("AéB\x00C");
  });
});
