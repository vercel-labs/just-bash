import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk reads UTF-8 from stdin", () => {
  it("splits multibyte fields correctly through a pipe", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 café 漢字\n" } });
    const result = await env.exec("cat /in.txt | awk '{ print $2 }'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("café\n");
  });
});
