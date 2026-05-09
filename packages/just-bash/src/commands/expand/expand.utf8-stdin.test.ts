import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("expand / unexpand read UTF-8 from stdin", () => {
  it("expand counts column positions by codepoint", async () => {
    // "café" is 4 codepoints; the tab should land on the next 8-column
    // tab-stop, i.e. fill columns 5-8 (4 spaces).
    const env = new Bash({ files: { "/in.txt": "café\tafter\n" } });
    const result = await env.exec("cat /in.txt | expand");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("café    after\n");
  });
});
