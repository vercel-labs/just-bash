import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tar reads UTF-8 from stdin", () => {
  it("round-trips multibyte file content through a tar | untar pipe", async () => {
    const env = new Bash({ files: { "/dir/k.txt": "한글 / café / 漢字\n" } });
    const r = await env.exec("tar -cf - dir | tar -xOf - dir/k.txt");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("한글 / café / 漢字\n");
  });
});
