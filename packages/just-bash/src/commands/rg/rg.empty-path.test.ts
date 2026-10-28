import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg empty path operands", () => {
  const createBash = () =>
    new Bash({
      cwd: "/data",
      files: { "/data/visible.txt": "needle\n" },
    });

  it.each([
    'rg -n needle ""',
    'rg --files ""',
  ])("reports an empty filename instead of searching cwd: %s", async (command) => {
    const result = await createBash().exec(command);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rg: : Unable to access path\n");
    expect(result.exitCode).toBe(2);
  });

  it.each([
    'rg --files -e "" visible.txt',
    'rg visible.txt --files -e ""',
    "rg --files -f missing.txt visible.txt",
  ])("ignores explicit patterns when listing files: %s", async (command) => {
    const result = await createBash().exec(command);
    expect(result.stdout).toBe("visible.txt\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves diagnostics when quiet file listing succeeds", async () => {
    expect(
      await createBash().exec('rg --files -q "" visible.txt'),
    ).toMatchObject({
      stdout: "",
      stderr: "rg: : Unable to access path\n",
      exitCode: 0,
    });
  });

  it("continues searching other explicit operands after an empty filename", async () => {
    const result = await createBash().exec('rg -n needle "" visible.txt');
    expect(result.stdout).toBe("visible.txt:1:needle\n");
    expect(result.stderr).toBe("rg: : Unable to access path\n");
    expect(result.exitCode).toBe(2);
  });
});
