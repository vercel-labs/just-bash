import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs root directory", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-root-"));
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "sub", "b.txt"), "b\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    false,
    true,
  ])("lstats the root as a directory (allowSymlinks: %s)", async (allowSymlinks) => {
    const rwfs = new ReadWriteFs({ root, allowSymlinks });

    const stat = await rwfs.lstat("/");

    expect(stat.isDirectory).toBe(true);
    expect(stat.isSymbolicLink).toBe(false);
  });

  it("reports EINVAL when reading the root as a symlink", async () => {
    const rwfs = new ReadWriteFs({ root });

    await expect(rwfs.readlink("/")).rejects.toThrow(
      "EINVAL: invalid argument, readlink '/'",
    );
  });

  it.each([
    ["find .", ".\n./a.txt\n./sub\n./sub/b.txt\n"],
    ["find /", "/\n/a.txt\n/sub\n/sub/b.txt\n"],
    ["find . -name '*.txt'", "./a.txt\n./sub/b.txt\n"],
    ["find / -type d", "/\n/sub\n"],
  ])("%s walks the tree from the root", async (script, stdout) => {
    const bash = new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" });

    const result = await bash.exec(script);

    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("file reports the root as a directory", async () => {
    const bash = new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" });

    const result = await bash.exec("file /");

    expect(result.stdout).toBe("/: directory\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("chmod -R descends from the root", async () => {
    const bash = new Bash({ fs: new ReadWriteFs({ root }), cwd: "/" });

    const result = await bash.exec("chmod -R 750 /");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.statSync(path.join(root, "sub")).mode & 0o777).toBe(0o750);
    expect(fs.statSync(path.join(root, "sub", "b.txt")).mode & 0o777).toBe(
      0o750,
    );
  });
});
