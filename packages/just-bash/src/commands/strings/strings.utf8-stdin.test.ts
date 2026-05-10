import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("strings reads UTF-8 from stdin", () => {
  it("works on raw bytes without TextEncoder double-encoding", async () => {
    // Mix printable ASCII + multibyte UTF-8 + a control byte. The ASCII
    // 'hello world' run is the only run that should survive the printable
    // filter; the UTF-8 leading bytes are non-printable.
    const env = new Bash({
      files: { "/in.bin": "\x01\x02hello world\x00한글" },
    });
    const r = await env.exec("cat /in.bin | strings -n 4");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello world");
  });
});
