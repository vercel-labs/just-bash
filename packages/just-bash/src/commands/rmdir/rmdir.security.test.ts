import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rmdir resource limits", () => {
  it("bounds -p parent traversal", async () => {
    const env = new Bash({
      files: { "/a/b/c/file": "x" },
      executionLimits: { maxTraversalWork: 1 },
    });
    await env.exec("rm /a/b/c/file");
    const result = await env.exec("rmdir -p /a/b/c");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("parent traversal limit exceeded");
  });
});
