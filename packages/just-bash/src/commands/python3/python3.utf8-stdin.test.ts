import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 reads UTF-8 from stdin", () => {
  it("executes piped Python with multibyte string literals", async () => {
    const env = new Bash({
      python: true,
      files: { "/in.py": "print('한글 / café / 漢字')\n" },
    });
    const result = await env.exec("cat /in.py | python3");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("한글 / café / 漢字");
  });
});
