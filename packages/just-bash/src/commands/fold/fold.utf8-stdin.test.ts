import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("fold reads UTF-8 from stdin", () => {
  it("wraps lines by codepoint count, not byte count", async () => {
    // 6 codepoints; -w 2 should split 3 chunks of 2 codepoints each. Without
    // decoding, fold would split mid-multibyte and corrupt the bytes.
    const env = new Bash({ files: { "/in.txt": "한글café\n" } });
    const result = await env.exec("cat /in.txt | fold -w 2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글\nca\nfé\n");
  });
});
