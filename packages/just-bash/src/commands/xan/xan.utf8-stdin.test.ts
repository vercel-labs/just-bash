import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xan reads UTF-8 from stdin", () => {
  it("preserves multibyte CSV fields through a pipe", async () => {
    const env = new Bash({
      files: { "/in.csv": "name,city\n홍길동,서울\nAlice,Paris\n" },
    });
    const result = await env.exec("cat /in.csv | xan select city");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("서울");
    expect(result.stdout).toContain("Paris");
  });
});
