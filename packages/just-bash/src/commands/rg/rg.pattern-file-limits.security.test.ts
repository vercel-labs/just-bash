import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

describe("rg pattern-file resource limits", () => {
  it("accounts aggregate bytes across pattern files before reading", async () => {
    const bash = new Bash({
      files: {
        "/one.patterns": "alpha\n",
        "/two.patterns": "beta\n",
        "/data.txt": "alpha beta\n",
      },
      executionLimits: { maxInputBytes: 10 },
    });

    const result = await bash.exec(
      "rg -f /one.patterns -f /two.patterns /data.txt",
    );

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "rg: aggregate input size limit exceeded (10 bytes)",
    );
  });

  it("prospectively leases raw, decoded, and retained pattern storage", async () => {
    const bash = new Bash({
      files: {
        "/patterns": "alpha\nbe",
        "/data.txt": "alpha\n",
      },
      executionLimits: { maxLiveBytes: 20 },
    });

    const result = await bash.exec("rg -f /patterns /data.txt");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("rg: live byte limit exceeded (20 bytes)");
  });

  it("bounds non-empty patterns while scanning without a split array", async () => {
    const bash = new Bash({
      files: {
        "/patterns": "a\nb\nc\nd\ne\n",
        "/data.txt": "a\n",
      },
      executionLimits: { maxArrayElements: 4 },
    });

    const result = await bash.exec("rg -f /patterns /data.txt");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("rg: pattern limit exceeded (4)");
  });

  it("charges pattern-file scanning against aggregate work", async () => {
    const bash = new Bash({
      files: {
        "/patterns": "abcdefghijk\n",
        "/data.txt": "abcdefghijk\n",
      },
      executionLimits: { maxWorkUnits: 10 },
    });

    const result = await bash.exec("rg -f /patterns /data.txt");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("rg pattern file parsing");
  });

  it("releases pattern storage after regex compilation fails", async () => {
    const bash = new Bash({
      files: {
        "/bad.patterns": "[\n",
        "/good.patterns": "a\n",
        "/data.txt": "a\n",
      },
      executionLimits: { maxLiveBytes: 10 },
    });

    const result = await bash.exec(
      "rg -f /bad.patterns /data.txt; rg -f /good.patterns /data.txt",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("a\n");
    expect(result.stderr).toContain("rg: invalid regex");
    expect(result.stderr).not.toContain("live byte limit exceeded");
  });

  it("keeps normal multi-file and stdin pattern compatibility", async () => {
    const bash = new Bash({
      files: {
        "/one.patterns": "alpha\n\n",
        "/two.patterns": "beta\n",
        "/data.txt": "alpha\nbeta\ngamma\n",
      },
    });

    const fromFiles = await bash.exec(
      "rg -f /one.patterns -f /two.patterns /data.txt",
    );
    const fromStdin = await bash.exec("printf 'gamma\\n' | rg -f - /data.txt");

    expect(fromFiles).toMatchObject({
      exitCode: 0,
      stdout: "alpha\nbeta\n",
      stderr: "",
    });
    expect(fromStdin).toMatchObject({
      exitCode: 0,
      stdout: "gamma\n",
      stderr: "",
    });
  });
});
