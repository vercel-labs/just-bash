import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("timeout forwards UTF-8 stdin", () => {
  it("byte-clean passthrough to the wrapped command", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 / café\n" } });
    const r = await env.exec("cat /in.txt | timeout 5 cat");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("한글 / café\n");
  });
});
