import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("wc reads UTF-8 from stdin", () => {
  // 한글 is 6 UTF-8 bytes, 2 codepoints. -c reports bytes, -m codepoints.
  it("-c counts bytes and -m counts codepoints from a piped UTF-8 file", async () => {
    const env = new Bash({ files: { "/in.txt": "한글" } });
    const c = await env.exec("cat /in.txt | wc -c");
    const m = await env.exec("cat /in.txt | wc -m");
    expect(c.stdout.trim()).toBe("6");
    expect(m.stdout.trim()).toBe("2");
  });
});
