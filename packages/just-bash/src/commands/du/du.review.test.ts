import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { EMPTY_BYTES } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { resolveLimits } from "../../limits.js";
import { duCommand } from "./du.js";

class FaultFs extends InMemoryFs {
  reads = 0;
  override async readdir(path: string): Promise<string[]> {
    if (path !== "/data" && path !== "/") {
      this.reads++;
      throw new Error("EACCES: permission denied");
    }
    return super.readdir(path);
  }
}

describe("du review regressions", () => {
  it("stops retaining diagnostics at the combined output limit", async () => {
    const fs = new FaultFs();
    for (let i = 0; i < 100; i++)
      await fs.mkdir(`/data/locked${i}`, { recursive: true });
    const result = await new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxOutputSize: 512 },
    }).exec("du -s data");
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      ["0", "1", "10", "11", "12", "13", "14", "15"]
        .map(
          (suffix) =>
            `du: cannot read directory 'data/locked${suffix}': Permission denied\n`,
        )
        .join("") +
        "bash: du: total output size exceeded (>512 bytes), increase executionLimits.maxOutputSize\n",
    );
    expect(fs.reads).toBeLessThan(10);
  });

  it.each([
    false,
    true,
  ])("bounds a long operand before another failed read (standalone: %s)", async (standalone) => {
    const fs = new FaultFs({
      "/data/locked/file": "x",
      "/data/next/file": "x",
    });
    const operand = `${"./".repeat(512)}data`;
    if (standalone) {
      await expect(
        duCommand.execute(["-s", operand], {
          fs,
          cwd: "/",
          env: new Map(),
          stdin: EMPTY_BYTES,
          limits: resolveLimits({ maxOutputSize: 512 }),
        }),
      ).rejects.toBeInstanceOf(ExecutionLimitError);
    } else {
      const result = await new Bash({
        fs,
        cwd: "/",
        executionLimits: { maxOutputSize: 512 },
      }).exec(`du -s ${operand}`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: du: total output size exceeded (>512 bytes), increase executionLimits.maxOutputSize\n",
      );
      expect(result.exitCode).not.toBe(0);
    }
    expect(fs.reads).toBe(1);
  });

  it("keeps both diagnostics and later siblings after a child lstat fails", async () => {
    class ChildFaultFs extends InMemoryFs {
      override async readdir(path: string): Promise<string[]> {
        if (path === "/data/locked")
          throw new Error("EACCES: permission denied");
        return super.readdir(path);
      }
      override async lstat(path: string) {
        if (path === "/data/no-search/file")
          throw new Error("EACCES: permission denied");
        return super.lstat(path);
      }
    }
    const fs = new ChildFaultFs({
      "/data/a/file": "x".repeat(1024),
      "/data/locked/file": "x",
      "/data/no-search/file": "x",
      "/data/z/file": "x".repeat(2048),
      "/other/file": "x".repeat(1024),
    });
    const result = await new Bash({ fs, cwd: "/" }).exec("du data other");
    expect(result).toMatchObject({
      stdout:
        "1\tdata/a\n1\tdata/locked\n1\tdata/no-search\n2\tdata/z\n3\tdata\n1\tother\n",
      stderr:
        "du: cannot read directory 'data/locked': Permission denied\ndu: cannot access 'data/no-search/file': Permission denied\n",
      exitCode: 1,
    });
  });

  it.each([
    "/",
    "///",
  ])("formats root rows and diagnostics for %s", async (operand) => {
    const fs = new FaultFs({ "/data/locked/file": "x" });
    const result = await duCommand.execute([operand], {
      fs,
      cwd: "/",
      env: new Map(),
      stdin: EMPTY_BYTES,
      limits: resolveLimits(),
    });
    expect(result).toMatchObject({
      stdout: "1\t/data/locked\n1\t/data\n1\t/\n",
      stderr: "du: cannot read directory '/data/locked': Permission denied\n",
      exitCode: 1,
    });
  });

  it.each([
    "data/",
    "data///",
    "./data//",
  ])("shares path formatting for %s", async (operand) => {
    const fs = new FaultFs({ "/data/locked/file": "x" });
    const result = await new Bash({ fs, cwd: "/" }).exec(`du ${operand}`);
    const prefix = operand.replace(/\/+$/, "");
    expect(result).toMatchObject({
      stdout: `1\t${prefix}/locked\n1\t${operand.replace(/\/+$/, "/")}\n`,
      stderr: `du: cannot read directory '${prefix}/locked': Permission denied\n`,
      exitCode: 1,
    });
  });
});
