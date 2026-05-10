import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("uniq reads UTF-8 from stdin", () => {
  it("default uniq preserves bytes byte-for-byte", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\n한글\ncafé\n" } });
    const result = await env.exec("cat /in.txt | uniq");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글\ncafé\n");
  });

  it("uniq -i case-folds without corrupting UTF-8 leading bytes", async () => {
    const env = new Bash({ files: { "/in.txt": "café\nCAFÉ\n" } });
    const result = await env.exec("cat /in.txt | uniq -i");
    expect(result.exitCode).toBe(0);
    // Lines case-fold to the same value, so they collapse — first byte-perfect
    // line wins, no 0xC3→0xE3 mutation in the surviving output.
    expect(result.stdout).toBe("café\n");
  });
});
