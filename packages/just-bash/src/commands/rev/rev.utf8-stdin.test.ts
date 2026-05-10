import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rev reads UTF-8 from stdin", () => {
  it("reverses by codepoint, not by latin1 byte", async () => {
    const env = new Bash({ files: { "/in.txt": "한글\n" } });
    const result = await env.exec("cat /in.txt | rev");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("글한\n");
  });
});
