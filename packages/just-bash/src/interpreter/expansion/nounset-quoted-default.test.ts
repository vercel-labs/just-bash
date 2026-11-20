import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("nounset with a whole-word quoted parameter expansion", () => {
  it("still fires for ${#var} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec('set -u\necho "${#JB_UNSET}"\necho reached');
    expect(result.stderr).toBe("bash: JB_UNSET: unbound variable\n");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("still fires for a bare ${var} as a whole double-quoted word", async () => {
    const env = new Bash();
    const result = await env.exec('set -u\necho "${JB_UNSET}"\necho reached');
    expect(result.stderr).toBe("bash: JB_UNSET: unbound variable\n");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(1);
  });
});
