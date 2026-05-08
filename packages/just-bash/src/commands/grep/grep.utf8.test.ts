import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("grep utf8 input decoding", () => {
  it("matches Korean pattern from stdin and file input", async () => {
    const encodedLines = new TextEncoder().encode("한국\n영어\n한국어\n");
    const env = new Bash({
      files: {
        "/korean.txt": encodedLines,
      },
    });

    const stdinResult = await env.exec("cat /korean.txt | grep '한국'");
    expect(stdinResult.exitCode).toBe(0);
    expect(stdinResult.stdout).toBe("한국\n한국어\n");

    const fileResult = await env.exec("grep '한국' /korean.txt");
    expect(fileResult.exitCode).toBe(0);
    expect(fileResult.stdout).toBe("한국\n한국어\n");
  });

  it("counts non-ascii matches with -c", async () => {
    const env = new Bash({
      files: {
        "/count.txt": "한\n둘\n한글\n셋\n",
      },
    });

    const result = await env.exec("grep -c '한' /count.txt");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("2\n");
  });

  it("matches anchored utf8 patterns with -E", async () => {
    const env = new Bash({
      files: {
        "/anchor.txt": "한글\n영어\n한자\n",
      },
    });

    const result = await env.exec("grep -E '^한' /anchor.txt");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글\n한자\n");
  });
});
