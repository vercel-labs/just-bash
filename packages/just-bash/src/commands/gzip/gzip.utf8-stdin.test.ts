import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("gzip reads UTF-8 from stdin", () => {
  it("round-trips multibyte text through gzip / gunzip", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 / café / 漢字\n" } });
    const r = await env.exec("cat /in.txt | gzip | gunzip");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("한글 / café / 漢字\n");
  });
});
