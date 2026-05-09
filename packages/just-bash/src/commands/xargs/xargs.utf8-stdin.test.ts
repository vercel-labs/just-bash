import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xargs reads UTF-8 from stdin", () => {
  it("preserves multibyte items split on whitespace", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\ncafé\n漢字\n" } });
    const result = await env.exec("cat /in.txt | xargs echo");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 café 漢字\n");
  });
});
