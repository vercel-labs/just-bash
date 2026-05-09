import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sed reads UTF-8 from stdin", () => {
  it("matches and replaces multibyte text from a piped file", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 old café\n" } });
    const result = await env.exec("cat /in.txt | sed 's/old/NEW/'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 NEW café\n");
  });
});
