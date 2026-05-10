import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("html-to-markdown reads UTF-8 from stdin", () => {
  it("preserves multibyte text in piped HTML", async () => {
    const env = new Bash({
      files: { "/in.html": "<p>한글 / café / 漢字</p>\n" },
    });
    const result = await env.exec("cat /in.html | html-to-markdown");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("한글 / café / 漢字");
  });
});
