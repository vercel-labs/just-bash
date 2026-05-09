import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cut reads UTF-8 from stdin", () => {
  it("-c slices by codepoint, not by byte", async () => {
    const env = new Bash({ files: { "/in.txt": "漢字\n" } });
    const result = await env.exec("cat /in.txt | cut -c 1-2");
    expect(result.exitCode).toBe(0);
    // -c 1-2 should keep both codepoints, not 2 of the 6 bytes.
    expect(result.stdout).toBe("漢字\n");
  });

  it("-f stays byte-clean (delimiters are ASCII, multibyte fields survive)", async () => {
    const env = new Bash({ files: { "/in.txt": "한글:café:漢字\n" } });
    const result = await env.exec("cat /in.txt | cut -d: -f2");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("café\n");
  });
});
