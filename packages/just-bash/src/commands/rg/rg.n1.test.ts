// Automa N1; message/heading controls ported from vercel-labs/just-bash#705/#712.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("rg N1 output controls and budgets", () => {
  for (const value of ["-1", "1.5", "bad", "9007199254740992"]) {
    it(`rejects invalid max-columns ${value}`, async () => {
      const result = await new Bash().exec(
        `rg --max-columns=${value} match /f`,
      );
      expect(result).toMatchObject({
        stdout: "",
        stderr: `rg: invalid --max-columns value: ${value}\n`,
        exitCode: 2,
      });
    });
  }

  it("restores file diagnostics with --messages", async () => {
    const result = await new Bash().exec(
      "rg --no-messages --messages match /missing",
    );
    expect(result).toMatchObject({
      stdout: "",
      stderr: "rg: /missing: Unable to access path\n",
      exitCode: 2,
    });
  });

  it("does not suppress regex errors", async () => {
    const result = await new Bash().exec("rg --no-messages '[' /missing");
    expect(result).toMatchObject({
      stdout: "",
      stderr: "rg: invalid regex: [\n",
      exitCode: 2,
    });
  });

  it("does not suppress fatal resource errors", async () => {
    const bash = new Bash({
      files: { "/f": "a".repeat(30) },
      executionLimits: { maxLiveBytes: 10 },
    });
    const result = await bash.exec("rg --no-messages -M5 a /f");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("live byte limit exceeded");
  });

  it("charges binary conversion before allocating the additional text", async () => {
    const bash = new Bash({
      files: { "/f": "a\0".repeat(15) },
      executionLimits: { maxLiveBytes: 80 },
    });
    const result = await bash.exec("rg -uuu a /f");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("live byte limit exceeded");
  });

  it("charges max-columns preview matching against existing work limits", async () => {
    const bash = new Bash({
      files: { "/f": "a".repeat(100) },
      executionLimits: { maxLoopIterations: 20 },
    });
    const result = await bash.exec(
      "rg -M5 --max-columns-preview --vimgrep a /f",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("matching work limit exceeded");
  });

  it("leaves JSON match data intact", async () => {
    const bash = new Bash({ files: { "/f": "long match\n" } });
    const limited = await bash.exec(
      "rg --json -M3 --max-columns-preview match /f",
    );
    const unlimited = await bash.exec("rg --json match /f");
    expect(limited).toMatchObject({
      stdout: unlimited.stdout,
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not grant hidden traversal for --no-ignore followed by one -u", async () => {
    const bash = new Bash({
      cwd: "/p",
      files: { "/p/.hidden": "match\n", "/p/f": "match\n" },
    });
    const result = await bash.exec("rg -n --no-ignore -u match .");
    expect(result).toMatchObject({
      stdout: "./f:1:match\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
