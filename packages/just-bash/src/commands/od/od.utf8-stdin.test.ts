import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("od reads UTF-8 from stdin", () => {
  it("dumps the raw UTF-8 bytes byte-by-byte (3-digit octal)", async () => {
    const env = new Bash({ files: { "/in.txt": "한" } });
    const r = await env.exec("cat /in.txt | od");
    expect(r.exitCode).toBe(0);
    // 한 = bytes 0xED 0x95 0x9C → octal 355 225 234. The fact that we see
    // these specific bytes (not e.g. 303 255 — UTF-8 of U+00ED) proves the
    // raw bytes survived the pipe instead of being decoded-then-re-encoded.
    const tokens = r.stdout.trim().split(/\s+/);
    expect(tokens).toContain("355");
    expect(tokens).toContain("225");
    expect(tokens).toContain("234");
  });
});
