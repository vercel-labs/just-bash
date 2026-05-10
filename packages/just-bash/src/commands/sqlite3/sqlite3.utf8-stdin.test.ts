import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sqlite3 reads UTF-8 from stdin", () => {
  it("preserves multibyte string literals piped as SQL", async () => {
    const env = new Bash({
      files: { "/q.sql": "SELECT '한글 / café / 漢字' AS msg;\n" },
    });
    const result = await env.exec("cat /q.sql | sqlite3 :memory:");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("한글 / café / 漢字");
  });
});
