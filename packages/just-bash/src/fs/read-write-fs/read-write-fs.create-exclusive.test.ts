import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs createExclusive", () => {
  let root: string;
  let rwfs: ReadWriteFs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-create-excl-"));
    rwfs = new ReadWriteFs({ root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates an empty file with the requested mode already applied", async () => {
    await rwfs.createExclusive("/private.txt", { mode: 0o600 });

    const target = path.join(root, "private.txt");
    expect(fs.statSync(target).mode & 0o7777).toBe(0o600);
    expect(fs.readFileSync(target, "utf8")).toBe("");
  });

  it("creates a directory with the requested mode already applied", async () => {
    await rwfs.createExclusive("/private-dir", {
      mode: 0o700,
      directory: true,
    });

    const target = path.join(root, "private-dir");
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(fs.statSync(target).mode & 0o7777).toBe(0o700);
  });

  it("never widens permissions via a pre-existing umask-style default", async () => {
    // The mode must come from the creating syscall, not a later chmod: at no
    // point should the entry be observable as 0644.
    await rwfs.createExclusive("/tight.txt", { mode: 0o600 });
    expect(fs.statSync(path.join(root, "tight.txt")).mode & 0o777).toBe(0o600);
  });

  it("refuses to overwrite an existing file", async () => {
    fs.writeFileSync(path.join(root, "taken.txt"), "original");

    await expect(
      rwfs.createExclusive("/taken.txt", { mode: 0o600 }),
    ).rejects.toThrow("EEXIST");
    expect(fs.readFileSync(path.join(root, "taken.txt"), "utf8")).toBe(
      "original",
    );
  });

  it("refuses to overwrite an existing directory", async () => {
    fs.mkdirSync(path.join(root, "taken-dir"));

    await expect(
      rwfs.createExclusive("/taken-dir", { mode: 0o700, directory: true }),
    ).rejects.toThrow("EEXIST");
  });

  it("treats a symlink occupying the name as a collision, not a target", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-outside-"));
    const victim = path.join(outside, "victim.txt");
    fs.writeFileSync(victim, "untouched");
    fs.symlinkSync(victim, path.join(root, "link.txt"));

    try {
      await expect(
        rwfs.createExclusive("/link.txt", { mode: 0o600 }),
      ).rejects.toThrow(/EEXIST|ENOENT|EACCES/);
      // The symlink target must not have been created through or truncated.
      expect(fs.readFileSync(victim, "utf8")).toBe("untouched");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("treats a dangling symlink as a collision", async () => {
    fs.symlinkSync(path.join(root, "nonexistent"), path.join(root, "dead.txt"));

    await expect(
      rwfs.createExclusive("/dead.txt", { mode: 0o600 }),
    ).rejects.toThrow(/EEXIST|ENOENT|EACCES/);
    expect(fs.existsSync(path.join(root, "nonexistent"))).toBe(false);
  });

  it("fails when the parent directory does not exist", async () => {
    await expect(
      rwfs.createExclusive("/missing/file.txt", { mode: 0o600 }),
    ).rejects.toThrow("ENOENT");
  });

  it("rejects paths escaping the root", async () => {
    await expect(
      rwfs.createExclusive("/../escape.txt", { mode: 0o600 }),
    ).resolves.toBeUndefined();
    // Clamped to the root rather than written outside it.
    expect(fs.existsSync(path.join(root, "escape.txt"))).toBe(true);
  });
});
