import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("paste reads UTF-8 from stdin", () => {
  it("zips multibyte lines column-wise", async () => {
    const env = new Bash({
      files: { "/a.txt": "한글\n漢字\n", "/b.txt": "café\nbé\n" },
    });
    const result = await env.exec("cat /a.txt | paste - /b.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글\tcafé\n漢字\tbé\n");
  });
});
