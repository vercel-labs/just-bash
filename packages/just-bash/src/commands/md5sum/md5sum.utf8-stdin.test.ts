import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("md5sum reads UTF-8 from stdin", () => {
  it("hashes the raw UTF-8 bytes (not double-encoded)", async () => {
    const env = new Bash({ files: { "/in.txt": "한글" } });
    const r = await env.exec("cat /in.txt | md5sum");
    expect(r.exitCode).toBe(0);
    // md5 of the UTF-8 bytes of "한글" (6 bytes: ed 95 9c ea b8 80)
    expect(r.stdout).toBe("52b8c54ab4ea672ee6cdfdfef0a31db4  -\n");
  });
});
