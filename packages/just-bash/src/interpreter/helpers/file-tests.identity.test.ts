import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "../../fs/read-write-fs/read-write-fs.js";

describe("binary file-test identity semantics", () => {
  it("compares symlink and hard-link aliases by filesystem identity", async () => {
    const bash = new Bash({ files: { "/target": "data" } });
    await bash.fs.symlink("/target", "/symlink");
    await bash.fs.link("/target", "/hardlink");

    const result = await bash.exec(
      "[ /target -ef /symlink ]; echo $?; [ /target -ef /hardlink ]; echo $?",
    );
    expect(result.stdout).toBe("0\n0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("implements one-sided missing-file semantics for -nt and -ot", async () => {
    const bash = new Bash({ files: { "/present": "data" } });
    const result = await bash.exec(`
      [ /present -nt /missing ]; echo $?
      [ /missing -ot /present ]; echo $?
      [ /missing -nt /present ]; echo $?
      [ /present -ot /missing ]; echo $?
    `);
    expect(result.stdout).toBe("0\n0\n1\n1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("uses canonical and device/inode identity on a real filesystem", async () => {
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "just-bash-file-identity-"),
    );
    try {
      const realFs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await realFs.writeFile("/target", "data");
      await realFs.symlink("/target", "/symlink");
      await realFs.link("/target", "/hardlink");
      const bash = new Bash({ fs: realFs, cwd: "/" });

      const result = await bash.exec(
        "[ /target -ef /symlink ]; echo $?; [ /target -ef /hardlink ]; echo $?",
      );
      expect(result.stdout).toBe("0\n0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
