/**
 * Tests for default-deny symlink behavior (allowSymlinks: false).
 *
 * Verifies that both OverlayFs and ReadWriteFs correctly block symlink
 * creation and traversal by default, while still allowing lstat/readlink
 * on existing symlinks and normal (non-symlink) operations.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IFileSystem } from "./interface.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestContext {
  tempDir: string;
  fsImpl: IFileSystem;
}

// Default: allowSymlinks is false (not specified)
function setupOverlay(tempDir: string): IFileSystem {
  return new OverlayFs({ root: tempDir, mountPoint: "/" });
}

function setupReadWrite(tempDir: string): IFileSystem {
  return new ReadWriteFs({ root: tempDir });
}

// With symlinks enabled
function setupOverlayWithSymlinks(tempDir: string): IFileSystem {
  return new OverlayFs({
    root: tempDir,
    mountPoint: "/",
    allowSymlinks: true,
  });
}

function setupReadWriteWithSymlinks(tempDir: string): IFileSystem {
  return new ReadWriteFs({ root: tempDir, allowSymlinks: true });
}

// ---------------------------------------------------------------------------
// Parameterised test suite — default deny (allowSymlinks: false)
// ---------------------------------------------------------------------------
describe.each([
  ["OverlayFs", setupOverlay],
  ["ReadWriteFs", setupReadWrite],
])("%s — default-deny symlinks", (_name, factory) => {
  let ctx: TestContext;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nosym-"));
    fs.writeFileSync(path.join(tempDir, "real.txt"), "real content");
    fs.mkdirSync(path.join(tempDir, "subdir"));
    fs.writeFileSync(
      path.join(tempDir, "subdir", "nested.txt"),
      "nested content",
    );
    // Create a real-FS symlink pointing to a file within sandbox
    fs.symlinkSync(
      path.join(tempDir, "real.txt"),
      path.join(tempDir, "link-to-real.txt"),
    );
    // Create a real-FS directory symlink
    fs.symlinkSync(
      path.join(tempDir, "subdir"),
      path.join(tempDir, "link-to-subdir"),
    );

    ctx = { tempDir, fsImpl: factory(tempDir) };
  });

  afterEach(() => {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // symlink() is blocked
  // -----------------------------------------------------------------------
  describe("symlink() blocked", () => {
    it("should throw EPERM when creating a symlink", async () => {
      await expect(
        ctx.fsImpl.symlink("/real.txt", "/new-link"),
      ).rejects.toThrow("EPERM");
    });
  });

  // -----------------------------------------------------------------------
  // readFile through real-FS symlinks is blocked
  // -----------------------------------------------------------------------
  describe("readFile through symlink", () => {
    it("should reject readFile through a file symlink", async () => {
      await expect(ctx.fsImpl.readFile("/link-to-real.txt")).rejects.toThrow();
    });

    it("should reject readFile through a directory symlink", async () => {
      await expect(
        ctx.fsImpl.readFile("/link-to-subdir/nested.txt"),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // stat through real-FS symlinks is blocked
  // -----------------------------------------------------------------------
  describe("stat through symlink", () => {
    it("should reject stat through a file symlink", async () => {
      await expect(ctx.fsImpl.stat("/link-to-real.txt")).rejects.toThrow();
    });

    it("should reject stat through a directory symlink", async () => {
      await expect(
        ctx.fsImpl.stat("/link-to-subdir/nested.txt"),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // realpath through real-FS symlinks is blocked
  // -----------------------------------------------------------------------
  describe("realpath through symlink", () => {
    it("should reject realpath on a file symlink", async () => {
      await expect(ctx.fsImpl.realpath("/link-to-real.txt")).rejects.toThrow();
    });

    it("should reject realpath through a directory symlink", async () => {
      await expect(
        ctx.fsImpl.realpath("/link-to-subdir/nested.txt"),
      ).rejects.toThrow();
    });

    it("should resolve realpath on a regular file", async () => {
      const resolved = await ctx.fsImpl.realpath("/real.txt");
      expect(resolved).toBe("/real.txt");
    });
  });

  // -----------------------------------------------------------------------
  // lstat on real-FS symlinks works (returns symlink info)
  // -----------------------------------------------------------------------
  describe("lstat on symlink", () => {
    it("should return symlink info for a file symlink", async () => {
      const stat = await ctx.fsImpl.lstat("/link-to-real.txt");
      expect(stat.isSymbolicLink).toBe(true);
      expect(stat.isFile).toBe(false);
    });

    it("should return symlink info for a directory symlink", async () => {
      const stat = await ctx.fsImpl.lstat("/link-to-subdir");
      expect(stat.isSymbolicLink).toBe(true);
      expect(stat.isDirectory).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // readlink on real-FS symlinks works
  // -----------------------------------------------------------------------
  describe("readlink on symlink", () => {
    it("should read the target of a file symlink", async () => {
      const target = await ctx.fsImpl.readlink("/link-to-real.txt");
      expect(typeof target).toBe("string");
      expect(target.length).toBeGreaterThan(0);
    });

    it("should read the target of a directory symlink", async () => {
      const target = await ctx.fsImpl.readlink("/link-to-subdir");
      expect(typeof target).toBe("string");
      expect(target.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // readdir lists symlink entries (but can't follow them)
  // -----------------------------------------------------------------------
  describe("readdir with symlinks", () => {
    it("should list symlink entries in directory listing", async () => {
      const entries = await ctx.fsImpl.readdir("/");
      expect(entries).toContain("link-to-real.txt");
      expect(entries).toContain("link-to-subdir");
      expect(entries).toContain("real.txt");
      expect(entries).toContain("subdir");
    });
  });

  // -----------------------------------------------------------------------
  // Non-symlink operations work normally
  // -----------------------------------------------------------------------
  describe("non-symlink operations", () => {
    it("should read regular files", async () => {
      const content = await ctx.fsImpl.readFile("/real.txt");
      expect(content).toBe("real content");
    });

    it("should stat regular files", async () => {
      const stat = await ctx.fsImpl.stat("/real.txt");
      expect(stat.isFile).toBe(true);
    });

    it("should readdir regular directories", async () => {
      const entries = await ctx.fsImpl.readdir("/subdir");
      expect(entries).toContain("nested.txt");
    });

    it("should read files in regular subdirectories", async () => {
      const content = await ctx.fsImpl.readFile("/subdir/nested.txt");
      expect(content).toBe("nested content");
    });

    it("should check existence of regular files", async () => {
      expect(await ctx.fsImpl.exists("/real.txt")).toBe(true);
      expect(await ctx.fsImpl.exists("/nonexistent")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// allowSymlinks: true restores full behavior
// ---------------------------------------------------------------------------
describe.each([
  ["OverlayFs", setupOverlayWithSymlinks],
  ["ReadWriteFs", setupReadWriteWithSymlinks],
])("%s — allowSymlinks: true restores behavior", (_name, factory) => {
  let ctx: TestContext;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sym-ok-"));
    fs.writeFileSync(path.join(tempDir, "target.txt"), "target content");
    fs.symlinkSync(
      path.join(tempDir, "target.txt"),
      path.join(tempDir, "link.txt"),
    );

    ctx = { tempDir, fsImpl: factory(tempDir) };
  });

  afterEach(() => {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
  });

  it("should create symlinks", async () => {
    await ctx.fsImpl.symlink("/target.txt", "/new-link");
    const stat = await ctx.fsImpl.lstat("/new-link");
    expect(stat.isSymbolicLink).toBe(true);
  });

  it("should read through file symlinks", async () => {
    const content = await ctx.fsImpl.readFile("/link.txt");
    expect(content).toBe("target content");
  });

  it("should stat through file symlinks", async () => {
    const stat = await ctx.fsImpl.stat("/link.txt");
    expect(stat.isFile).toBe(true);
  });
});
