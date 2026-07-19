import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("shopt resource limits", () => {
  it("bounds aggregate invalid-option diagnostics", async () => {
    const env = new Bash({
      executionLimits: { maxStringLength: 100, maxOutputSize: 40 },
    });
    const result = await env.exec("shopt invalid_one invalid_two");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("shopt: output size limit exceeded");
  });

  it("bounds argument count before copying option names", async () => {
    const env = new Bash({ executionLimits: { maxArrayElements: 4 } });
    const result = await env.exec("shopt a b c d e");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("shopt: argument limit exceeded");
  });

  it("applies the same diagnostic bound to shopt -o", async () => {
    const env = new Bash({
      executionLimits: { maxStringLength: 100, maxOutputSize: 40 },
    });
    const result = await env.exec("shopt -o invalid_one invalid_two");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("shopt: output size limit exceeded");
  });
});
