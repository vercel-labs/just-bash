import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("head / tail / tac read UTF-8 from stdin", () => {
  it("head preserves multibyte lines", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\nfoo\n漢字\n" } });
    const result = await env.exec("cat /in.txt | head -1");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글\n");
  });

  it("tail preserves multibyte lines", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\nfoo\n漢字\n" } });
    const result = await env.exec("cat /in.txt | tail -1");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("漢字\n");
  });

  it("tac preserves multibyte lines (reversed)", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\n漢字\n" } });
    const result = await env.exec("cat /in.txt | tac");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("漢字\n한글\n");
  });
});
