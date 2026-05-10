import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("comm reads UTF-8 from stdin", () => {
  it("compares multibyte lines byte-for-byte", async () => {
    const env = new Bash({
      files: {
        "/a.txt": "café\n한글\n",
        "/b.txt": "café\n漢字\n",
      },
    });
    const result = await env.exec("cat /a.txt | comm - /b.txt");
    expect(result.exitCode).toBe(0);
    // Lines unique to first / second / shared columns.
    expect(result.stdout).toContain("café");
    expect(result.stdout).toContain("한글");
    expect(result.stdout).toContain("漢字");
  });
});
