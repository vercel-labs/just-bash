import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tee reads UTF-8 from stdin", () => {
  it("passes UTF-8 stdin through to stdout unchanged", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 / café / 漢字\n" } });
    const result = await env.exec("cat /in.txt | tee /out.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 / café / 漢字\n");
  });

  it("writes UTF-8 text from a heredoc to a file", async () => {
    // The heredoc path is the one that lands as a real Unicode string in
    // tee's stdin (no upstream byte buffer), so the file write goes through
    // the utf8-by-default encoding and round-trips bytes-perfectly.
    const env = new Bash();
    await env.exec("tee /out.txt <<< '한글 / café'");
    const written = await env.fs.readFileBuffer("/out.txt");
    expect(new TextDecoder().decode(written)).toBe("한글 / café\n");
  });
});
