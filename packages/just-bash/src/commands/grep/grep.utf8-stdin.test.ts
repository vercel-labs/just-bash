import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("grep reads UTF-8 from stdin", () => {
  it("matches multibyte patterns through a pipe", async () => {
    const env = new Bash({ files: { "/in.txt": "lineA\n한글 hit\nlineC\n" } });
    const result = await env.exec("cat /in.txt | grep '한글'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 hit\n");
  });
});
