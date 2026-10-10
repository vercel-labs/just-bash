import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("mapfile builtin", () => {
  describe("mapfile with UTF-8 input", () => {
    it("should store multibyte characters as single characters", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo -e "한글\\ncafé\\n漢字" | { mapfile -t A; echo "\${#A[0]} \${#A[1]} \${#A[2]} \${A[*]}"; }
      `);
      expect(result.stdout).toBe("2 4 2 한글 café 漢字\n");
    });
  });
});
