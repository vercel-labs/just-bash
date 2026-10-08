import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs directory removal without recursive", () => {
  let sandboxDir: string;
  let bash: Bash;

  beforeEach(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-rmdir-"));
    bash = new Bash({ fs: new ReadWriteFs({ root: sandboxDir }), cwd: "/" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  it("rmdir removes an empty directory", async () => {
    const result = await bash.exec("mkdir d && rmdir d");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(sandboxDir, "d"))).toBe(false);
  });

  it("rmdir -p removes each emptied parent", async () => {
    const result = await bash.exec("mkdir -p a/b/c && rmdir -p a/b/c");

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(sandboxDir, "a"))).toBe(false);
  });

  it("rmdir refuses a directory that is not empty", async () => {
    const result = await bash.exec("mkdir d && touch d/f && rmdir d");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "rmdir: failed to remove 'd': Directory not empty\n",
    );
    expect(result.exitCode).toBe(1);
    expect(fs.existsSync(path.join(sandboxDir, "d", "f"))).toBe(true);
  });

  it("find -delete removes an empty directory", async () => {
    const result = await bash.exec("mkdir e && find e -type d -empty -delete");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(sandboxDir, "e"))).toBe(false);
  });

  it("rm without -r still refuses a directory", async () => {
    const result = await bash.exec("mkdir d && rm d");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rm: cannot remove 'd': Is a directory\n");
    expect(result.exitCode).toBe(1);
    expect(fs.existsSync(path.join(sandboxDir, "d"))).toBe(true);
  });

  it("ln -sf refuses to replace an empty directory", async () => {
    const result = await bash.exec("mkdir d && ln -sf target d");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("ln: d: cannot overwrite directory\n");
    expect(result.exitCode).toBe(1);
    expect(fs.lstatSync(path.join(sandboxDir, "d")).isDirectory()).toBe(true);
  });
});

describe("ReadWriteFs.rm on a directory without recursive", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-rmdir-root-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-rmdir-outside-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  function errno(code: string): NodeJS.ErrnoException {
    const error = new Error(`${code}: host failure`) as NodeJS.ErrnoException;
    error.code = code;
    return error;
  }

  it("reports a directory that is not empty as ENOTEMPTY", async () => {
    const adapter = new ReadWriteFs({ root });
    fs.mkdirSync(path.join(root, "d"));
    fs.writeFileSync(path.join(root, "d", "f"), "");

    await expect(adapter.rm("/d")).rejects.toThrow(
      "ENOTEMPTY: directory not empty, rm '/d'",
    );
    expect(fs.existsSync(path.join(root, "d", "f"))).toBe(true);
  });

  it("reports rmdir's EEXIST as ENOTEMPTY", async () => {
    const adapter = new ReadWriteFs({ root });
    fs.mkdirSync(path.join(root, "d"));
    vi.spyOn(fs.promises, "rmdir").mockRejectedValue(errno("EEXIST"));

    await expect(adapter.rm("/d")).rejects.toThrow(
      "ENOTEMPTY: directory not empty, rm '/d'",
    );
  });

  it("does not report EEXIST from a file removal as ENOTEMPTY", async () => {
    const adapter = new ReadWriteFs({ root });
    fs.writeFileSync(path.join(root, "f"), "");
    vi.spyOn(fs.promises, "rm").mockRejectedValue(errno("EEXIST"));

    const error = await adapter.rm("/f").catch((value: unknown) => value);

    expect(String(error)).not.toContain("ENOTEMPTY");
  });

  it.each([
    false,
    true,
  ])("refuses when a parent is swapped for a symlink after lstat (allowSymlinks: %s)", async (allowSymlinks) => {
    const adapter = new ReadWriteFs({ root, allowSymlinks });
    fs.mkdirSync(path.join(root, "sub", "d"), { recursive: true });
    fs.mkdirSync(path.join(outside, "d"));
    const actual = fs.promises.lstat.bind(fs.promises);
    let swapped = false;
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (target) => {
      const stat = await actual(target);
      if (!swapped && String(target).endsWith(`${path.sep}sub${path.sep}d`)) {
        swapped = true;
        fs.renameSync(path.join(root, "sub"), path.join(root, "sub-moved"));
        fs.symlinkSync(outside, path.join(root, "sub"));
      }
      return stat;
    });

    await expect(adapter.rm("/sub/d")).rejects.toThrow("EACCES");
    expect(swapped).toBe(true);
    expect(fs.existsSync(path.join(outside, "d"))).toBe(true);
  });
});
