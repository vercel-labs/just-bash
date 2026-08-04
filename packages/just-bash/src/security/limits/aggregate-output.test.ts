import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("aggregate execution output accounting", () => {
  const succeedsAtSixBytes = [
    "printf 123456",
    "f() { printf 123456; }; f",
    "bash -c 'printf 123456'",
    "(printf 123456)",
    "{ printf 123456; }",
    "printf 123456 | cat",
  ];

  for (const script of succeedsAtSixBytes) {
    it(`does not refresh or double-charge through ${script}`, async () => {
      const bash = new Bash({ executionLimits: { maxOutputSize: 6 } });
      const result = await bash.exec(script);
      expect(result).toMatchObject({
        stdout: "123456",
        stderr: "",
        exitCode: 0,
      });
    });

    it(`enforces one shared byte below ${script}`, async () => {
      const bash = new Bash({ executionLimits: { maxOutputSize: 5 } });
      const result = await bash.exec(script);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toMatch(/size (?:limit )?exceeded/);
    });
  }

  it("charges output discarded by a redirect", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 5 } });
    const result = await bash.exec("printf 123456 > /dev/null");
    expect(result.exitCode).toBe(126);
  });

  it("shares accounting through xargs child executions", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 6 } });
    const result = await bash.exec("printf x | xargs printf 123456");
    expect(result).toMatchObject({ stdout: "123456", exitCode: 0 });
  });

  it("shares accounting through find -exec", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 6 } });
    const result = await bash.exec(
      "find / -maxdepth 0 -exec printf 123456 ';'",
    );
    expect(result).toMatchObject({ stdout: "123456", exitCode: 0 });
  });

  it("retains already-produced output when a later statement exceeds the limit", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 5 } });
    const result = await bash.exec("printf 123; printf 456");

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("123");
    expect(result.stderr).toMatch(/size (?:limit )?exceeded/);
  });

  it("retains partial compound output without charging it twice", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 5 } });
    const result = await bash.exec("{ printf 12; printf 34; printf 56; }");

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("1234");
    expect(result.stderr).toMatch(/size (?:limit )?exceeded/);
  });
});
