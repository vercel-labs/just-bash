import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("join reads UTF-8 from stdin", () => {
  it("joins on ASCII keys, preserves multibyte field values", async () => {
    const env = new Bash({
      files: {
        "/a.txt": "1 한글\n2 café\n",
        "/b.txt": "1 韓国\n2 法国\n",
      },
    });
    const result = await env.exec("cat /a.txt | join - /b.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("한글");
    expect(result.stdout).toContain("韓国");
    expect(result.stdout).toContain("café");
    expect(result.stdout).toContain("法国");
  });
});
