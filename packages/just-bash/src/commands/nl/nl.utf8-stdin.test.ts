import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("nl reads UTF-8 from stdin", () => {
  it("number-prefixes multibyte lines without altering them", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\ncafé\n" } });
    const result = await env.exec("cat /in.txt | nl");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("한글");
    expect(result.stdout).toContain("café");
  });
});
