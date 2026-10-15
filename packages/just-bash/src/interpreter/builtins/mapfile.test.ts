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
      expect(result.stderr).toBe("");
    });

    it("should count a multibyte line by its UTF-8 bytes for the length limit", async () => {
      const env = new Bash({ executionLimits: { maxStringLength: 10 } });
      const result = await env.exec(`
        printf "éééé\\n" | { mapfile -t A; echo "\${#A[0]}"; }
      `);
      expect(result.stdout).toBe("4\n");
      expect(result.stderr).toBe("");
    });

    it("should keep text read from a descriptor unchanged", async () => {
      const env = new Bash();
      const result = await env.exec(`
        mapfile -t A 3<<<"Ã©" <&3
        echo "\${#A[0]}"
      `);
      expect(result.stdout).toBe("2\n");
      expect(result.stderr).toBe("");
    });

    it("should decode UTF-8 after stdin is redirected with exec", async () => {
      const env = new Bash({ files: { "/in.txt": "한글\ncafé\n" } });
      const result = await env.exec(`
        exec < /in.txt
        mapfile -t A
        echo "\${#A[0]} \${#A[1]}"
      `);
      expect(result.stdout).toBe("2 4\n");
      expect(result.stderr).toBe("");
    });
  });
});
