import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("bash reads UTF-8 script from stdin", () => {
  it("parses and runs a piped script with multibyte string literals", async () => {
    const env = new Bash({
      files: { "/script.sh": 'echo "한글 / café / 漢字"\n' },
    });
    const result = await env.exec("cat /script.sh | bash");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 / café / 漢字\n");
  });
});
