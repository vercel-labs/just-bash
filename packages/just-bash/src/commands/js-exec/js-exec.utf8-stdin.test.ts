import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec reads UTF-8 from stdin", () => {
  it("executes piped JS code with multibyte string literals", async () => {
    const env = new Bash({
      javascript: true,
      files: { "/in.js": "console.log('한글 / café / 漢字')\n" },
    });
    const result = await env.exec("cat /in.js | js-exec");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("한글 / café / 漢字");
  });
});
