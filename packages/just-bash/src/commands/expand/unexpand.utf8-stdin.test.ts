import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("unexpand reads UTF-8 from stdin", () => {
  it("counts column positions by codepoint when collapsing spaces to tabs", async () => {
    // 8 leading spaces then text — should collapse to one tab.
    const env = new Bash({ files: { "/in.txt": "        한글\n" } });
    const r = await env.exec("cat /in.txt | unexpand");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("\t한글\n");
  });
});
