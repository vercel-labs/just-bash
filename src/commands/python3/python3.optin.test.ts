import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("python3 opt-in behavior", () => {
  it("should not have python3 when python option is not enabled", async () => {
    const env = new Bash(); // No python: true
    const result = await env.exec("python3 --version");
    // Command should fail (either "not found" or "not available" depending on context)
    expect(result.stderr).toMatch(/command not (found|available)/);
    expect(result.exitCode).toBe(127);
  });

  it(
    "should have python3 when python option is enabled",
    { timeout: 60000 },
    async () => {
      const env = new Bash({ python: true });
      const result = await env.exec("python3 --version");
      expect(result.stdout).toContain("Python 3.");
      expect(result.exitCode).toBe(0);
    },
  );

  it("should not have python when python option is not enabled", async () => {
    const env = new Bash(); // No python: true
    const result = await env.exec("python --version");
    // Command should fail (either "not found" or "not available" depending on context)
    expect(result.stderr).toMatch(/command not (found|available)/);
    expect(result.exitCode).toBe(127);
  });
});
