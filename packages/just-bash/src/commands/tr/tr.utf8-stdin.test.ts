import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tr reads UTF-8 from stdin", () => {
  it("translates by codepoint, matching the SET as the user spelled it", async () => {
    const env = new Bash({ files: { "/in.txt": "café\n" } });
    const result = await env.exec("cat /in.txt | tr 'é' 'X'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("cafX\n");
  });

  it("passes through non-matched multibyte chars unchanged", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 abc\n" } });
    const result = await env.exec("cat /in.txt | tr 'a-z' 'A-Z'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 ABC\n");
  });
});
