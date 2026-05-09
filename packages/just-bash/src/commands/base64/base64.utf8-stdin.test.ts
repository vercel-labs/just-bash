import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("base64 reads UTF-8 from stdin", () => {
  it("encodes / decodes UTF-8 byte sequences without re-encoding", async () => {
    const env = new Bash({ files: { "/in.txt": "한글" } });
    const enc = await env.exec("cat /in.txt | base64");
    expect(enc.exitCode).toBe(0);
    expect(enc.stdout.trim()).toBe("7ZWc6riA"); // base64 of UTF-8 bytes of 한글
    const dec = await env.exec("cat /in.txt | base64 | base64 -d");
    expect(dec.stdout).toBe("한글");
  });
});
