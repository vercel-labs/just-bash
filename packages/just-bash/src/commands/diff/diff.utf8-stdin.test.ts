import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("diff reads UTF-8 from stdin", () => {
  it("preserves multibyte lines in the diff output", async () => {
    const env = new Bash({
      files: {
        "/a.txt": "한글\nshared\n",
        "/b.txt": "different\nshared\n",
      },
    });
    const result = await env.exec("cat /a.txt | diff - /b.txt");
    // diff exits 1 when files differ.
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("한글");
    expect(result.stdout).toContain("different");
  });
});
