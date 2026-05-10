import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("split reads UTF-8 from stdin", () => {
  it("preserves multibyte content across split chunks", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\ncafé\n漢字\n" } });
    const r = await env.exec("cat /in.txt | split -l 1 - /tmp/chunk_");
    expect(r.exitCode).toBe(0);
    const aa = await env.fs.readFile("/tmp/chunk_aa", "utf8");
    const ab = await env.fs.readFile("/tmp/chunk_ab", "utf8");
    const ac = await env.fs.readFile("/tmp/chunk_ac", "utf8");
    expect(aa).toBe("한글\n");
    expect(ab).toBe("café\n");
    expect(ac).toBe("漢字\n");
  });
});
