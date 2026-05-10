import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cat reads UTF-8 from stdin", () => {
  it("byte-clean passthrough preserves multibyte input", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 / café / 漢字\n" } });
    const result = await env.exec("cat /in.txt | cat");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 / café / 漢字\n");
  });
});
