import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("time forwards UTF-8 stdin", () => {
  it("byte-clean passthrough to the wrapped command", async () => {
    const env = new Bash({ files: { "/in.txt": "한글 / café\n" } });
    const r = await env.exec("cat /in.txt | time cat");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("한글 / café\n");
  });

  it("keeps the established verbose command label", async () => {
    const result = await new Bash().exec("command time --verbose echo ok");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Command being timed: echo ok");
    expect(result.stderr).not.toContain("RuntimeCommand");
  });
});
