import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("grep with multiple -e patterns", () => {
  it("matches lines selected by any pattern", async () => {
    const env = new Bash({
      files: { "/test.txt": "aaa Q1\nbbb\nccc Q4\n" },
    });

    const result = await env.exec("grep -e Q1 -e Q4 /test.txt");

    expect(result.stdout).toBe("aaa Q1\nccc Q4\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps each pattern literal with -F", async () => {
    const env = new Bash({
      files: { "/test.txt": "a.b\naxb\nx*y\nxy\n" },
    });

    const result = await env.exec("grep -F -e 'a.b' -e 'x*y' /test.txt");

    expect(result.stdout).toBe("a.b\nx*y\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats non-option operands as files when -e is present", async () => {
    const env = new Bash({
      files: {
        "/one.txt": "needle one\n",
        "/two.txt": "needle two\n",
      },
    });

    const result = await env.exec("grep /one.txt -e needle /two.txt");

    expect(result.stdout).toBe("/one.txt:needle one\n/two.txt:needle two\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
