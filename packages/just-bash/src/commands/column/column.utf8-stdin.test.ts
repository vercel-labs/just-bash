import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("column reads UTF-8 from stdin", () => {
  it("preserves multibyte content piped through column", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 café 漢字\n" } });
    const result = await env.exec("cat /in.txt | column -t");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("한글");
    expect(result.stdout).toContain("café");
    expect(result.stdout).toContain("漢字");
  });
});
