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

  it("never splits an emoji surrogate pair", async () => {
    const env = new Bash({ files: { "/in.txt": "A😀B\n" } });
    const result = await env.exec("cat /in.txt | fold -w 1");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("A\n😀\nB\n");
    expect(result.stdout).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
  });

  it("counts the complete UTF-8 byte width of each codepoint", async () => {
    const env = new Bash({ files: { "/in.txt": "😀a\n" } });
    const result = await env.exec("cat /in.txt | fold -b -w 4");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("😀\na\n");
  });
});
