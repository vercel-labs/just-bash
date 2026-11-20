import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("od retained input bounds", () => {
  it("releases skipped file buffers before opening the next file", async () => {
    const files: Record<string, string> = Object.create(null);
    for (let index = 0; index < 50; index++)
      files[`/f${index}`] = "A".repeat(2048);
    const shell = new Bash({
      files,
      executionLimits: { maxLiveBytes: 64 * 1024 },
    });
    const result = await shell.exec(
      `od -An -tx1 -j${49 * 2048} -N8 ${Object.keys(files).join(" ")}`,
    );
    expect(result).toMatchObject({
      stdout: " 41 41 41 41 41 41 41 41\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accounts for high-byte binary input by actual byte length", async () => {
    const shell = new Bash({
      files: { "/in": new Uint8Array([255, 128, 0, 1]) },
      executionLimits: { maxInputBytes: 4 },
    });
    expect(await shell.exec("od -An -tx1 /in")).toMatchObject({
      stdout: " ff 80 00 01\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("bounds aggregate file input even when most bytes are skipped", async () => {
    const shell = new Bash({
      files: { "/a": "1234", "/b": "5678" },
      executionLimits: { maxInputBytes: 6 },
    });
    const result = await shell.exec("od -An -tx1 -j4 -N1 /a /b");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toMatch(/input.*limit exceeded/);
  });

  it("bounds repeated format work independently of byte input", async () => {
    const shell = new Bash({
      files: { "/a": "a".repeat(80) },
      executionLimits: { maxTraversalWork: 100 },
    });
    const result = await shell.exec("od -An -tx1 -tc /a");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("format work limit exceeded");
  });

  it("describes only its supported byte and address formats", async () => {
    const result = await new Bash().exec("od --help");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("x1/x2/u1/u2/o1/o2/c");
    expect(result.stdout).toContain("--skip-bytes");
  });
});
