import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg reads UTF-8 from stdin", () => {
  it("matches multibyte patterns from piped input", async () => {
    const env = new Bash({
      files: { "/in.txt": "miss\n한글 found\nmiss\n" },
    });
    const result = await env.exec("cat /in.txt | rg '한글'");
    expect(result.exitCode).toBe(0);
    // rg prefixes matches from stdin with a `<filename>:<line>:` source
    // identifier; the bytes after the last `:` are the matched line.
    const matched = result.stdout.split(":").slice(2).join(":");
    expect(matched.trim()).toBe("한글 found");
  });
});
