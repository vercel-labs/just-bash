/**
 * Security tests for MountableFs
 *
 * MountableFs routes operations to mounted filesystems.
 * These tests verify that symlink escape attempts, path traversal,
 * and cross-mount attacks are properly handled.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { OverlayFs } from "../overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "../read-write-fs/read-write-fs.js";
import { MountableFs } from "./mountable-fs.js";

describe("MountableFs Security", () => {
  describe("symlink within mounted InMemoryFs", () => {
    it("should follow symlinks within a single mount", async () => {
      const mounted = new InMemoryFs({
        "/target.txt": "content",
      });
      await mounted.symlink("/target.txt", "/link");

      const mfs = new MountableFs();
      mfs.mount("/mnt", mounted);

      const content = await mfs.readFile("/mnt/link");
      expect(content).toBe("content");
    });

    it("should handle circular symlinks in mounted fs", async () => {
      const mounted = new InMemoryFs();
      await mounted.symlink("/b", "/a");
      await mounted.symlink("/a", "/b");

      const mfs = new MountableFs();
      mfs.mount("/mnt", mounted);

      await expect(mfs.readFile("/mnt/a")).rejects.toThrow("ELOOP");
    });

    it("should handle broken symlinks in mounted fs", async () => {
      const mounted = new InMemoryFs();
      await mounted.symlink("/nonexistent", "/broken");

      const mfs = new MountableFs();
      mfs.mount("/mnt", mounted);

      await expect(mfs.readFile("/mnt/broken")).rejects.toThrow("ENOENT");
    });

    it("should not allow symlink to escape mount via path traversal", async () => {
      const base = new InMemoryFs({
        "/secret.txt": "TOP SECRET",
      });
      const mounted = new InMemoryFs();
      // This symlink points to ../../secret.txt - attempting to reach base fs
      await mounted.symlink("../../secret.txt", "/escape");

      const mfs = new MountableFs({ base });
      mfs.mount("/mnt/data", mounted);

      // Reading should fail - the symlink resolves within the mounted fs scope
      await expect(mfs.readFile("/mnt/data/escape")).rejects.toThrow("ENOENT");
    });
  });

  describe("cross-mount symlink isolation", () => {
    it("should not follow symlinks across mount boundaries via read", async () => {
      const mount1 = new InMemoryFs({
        "/secret.txt": "mount1 secret",
      });
      const mount2 = new InMemoryFs();
      // Create a symlink in mount2 pointing to a path that exists in mount1
      await mount2.symlink("/secret.txt", "/link");

      const mfs = new MountableFs();
      mfs.mount("/mnt/a", mount1);
      mfs.mount("/mnt/b", mount2);

      // The symlink /mnt/b/link -> /secret.txt resolves within mount2's scope
      // /secret.txt doesn't exist in mount2, so this should fail
      await expect(mfs.readFile("/mnt/b/link")).rejects.toThrow("ENOENT");
    });

    it("should isolate stat across mount boundaries", async () => {
      const mount1 = new InMemoryFs({
        "/file.txt": "mount1 file",
      });
      const mount2 = new InMemoryFs();
      await mount2.symlink("/file.txt", "/link");

      const mfs = new MountableFs();
      mfs.mount("/mnt/a", mount1);
      mfs.mount("/mnt/b", mount2);

      // stat through the symlink should resolve within mount2 only
      await expect(mfs.stat("/mnt/b/link")).rejects.toThrow("ENOENT");
    });
  });

  describe("path traversal via mount boundaries", () => {
    it("should normalize paths that try to escape via ..", async () => {
      const base = new InMemoryFs({
        "/secret.txt": "base secret",
      });
      const mounted = new InMemoryFs({
        "/file.txt": "mounted file",
      });

      const mfs = new MountableFs({ base });
      mfs.mount("/mnt/data", mounted);

      // Trying to read ../../secret.txt from within mount context
      // Path normalization in routePath should prevent escape
      const content = await mfs.readFile("/mnt/data/../data/file.txt");
      expect(content).toBe("mounted file");
    });

    it("should handle excessive .. at mount point boundary", async () => {
      const mounted = new InMemoryFs({
        "/file.txt": "content",
      });

      const mfs = new MountableFs();
      mfs.mount("/mnt/data", mounted);

      // Path /mnt/data/../../../etc/passwd normalizes to /etc/passwd
      // which doesn't exist in the base (InMemoryFs)
      await expect(
        mfs.readFile("/mnt/data/../../../etc/passwd"),
      ).rejects.toThrow("ENOENT");
    });

    it("should normalize path traversal from mount to base fs", async () => {
      const base = new InMemoryFs({
        "/sensitive.txt": "SENSITIVE DATA",
      });
      const mounted = new InMemoryFs();

      const mfs = new MountableFs({ base });
      mfs.mount("/mnt/data", mounted);

      // /mnt/data/../../sensitive.txt normalizes to /sensitive.txt
      // which correctly routes to the base fs (this is expected behavior -
      // the base fs IS accessible, mount isolation is per-mount not per-system)
      const content = await mfs.readFile("/mnt/data/../../sensitive.txt");
      expect(content).toBe("SENSITIVE DATA");
      // Same result via direct path
      const direct = await mfs.readFile("/sensitive.txt");
      expect(direct).toBe("SENSITIVE DATA");
    });
  });

  describe("mounted ReadWriteFs symlink security", () => {
    let tempDir: string;
    let outsideDir: string;
    let outsideFile: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mfs-rwfs-"));
      outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mfs-outside-"));
      outsideFile = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outsideFile, "OUTSIDE SECRET");
      fs.writeFileSync(path.join(tempDir, "allowed.txt"), "allowed");
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it("should block pre-existing OS symlink escape through mounted ReadWriteFs", async () => {
      // Create a real symlink inside tempDir pointing outside
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "escape-link"));
      } catch {
        return;
      }

      const rwfs = new ReadWriteFs({ root: tempDir });
      const mfs = new MountableFs();
      mfs.mount("/workspace", rwfs);

      // Reading through the symlink should be blocked
      await expect(mfs.readFile("/workspace/escape-link")).rejects.toThrow();

      // Direct file should work
      const content = await mfs.readFile("/workspace/allowed.txt");
      expect(content).toBe("allowed");
    });

    it("should block write via pre-existing OS symlink through mounted ReadWriteFs", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "write-escape"));
      } catch {
        return;
      }

      const rwfs = new ReadWriteFs({ root: tempDir });
      const mfs = new MountableFs();
      mfs.mount("/workspace", rwfs);

      await expect(
        mfs.writeFile("/workspace/write-escape", "PWNED"),
      ).rejects.toThrow();

      // Verify outside file not modified
      const real = fs.readFileSync(outsideFile, "utf8");
      expect(real).toBe("OUTSIDE SECRET");
    });

    it("should block stat info leak via pre-existing OS symlink through mounted ReadWriteFs", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "stat-escape"));
      } catch {
        return;
      }

      const rwfs = new ReadWriteFs({ root: tempDir });
      const mfs = new MountableFs();
      mfs.mount("/workspace", rwfs);

      await expect(mfs.stat("/workspace/stat-escape")).rejects.toThrow();
    });
  });

  describe("mounted OverlayFs symlink security", () => {
    let tempDir: string;
    let outsideDir: string;
    let outsideFile: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mfs-ofs-"));
      outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mfs-ofs-outside-"));
      outsideFile = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outsideFile, "OVERLAY OUTSIDE SECRET");
      fs.writeFileSync(path.join(tempDir, "allowed.txt"), "allowed content");
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it("should block stat info leak via real-fs symlink through mounted OverlayFs", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "stat-leak"));
      } catch {
        return;
      }

      const ofs = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const mfs = new MountableFs();
      mfs.mount("/overlay", ofs);

      await expect(mfs.stat("/overlay/stat-leak")).rejects.toThrow("ENOENT");
    });

    it("should block read via real-fs symlink through mounted OverlayFs", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "read-escape"));
      } catch {
        return;
      }

      const ofs = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const mfs = new MountableFs();
      mfs.mount("/overlay", ofs);

      await expect(mfs.readFile("/overlay/read-escape")).rejects.toThrow();
    });

    it("should allow reading legitimate files through mounted OverlayFs", async () => {
      const ofs = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const mfs = new MountableFs();
      mfs.mount("/overlay", ofs);

      const content = await mfs.readFile("/overlay/allowed.txt");
      expect(content).toBe("allowed content");
    });

    it("should block mkdir through real-fs symlink pointing outside via mounted ReadWriteFs", async () => {
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "mkdir-escape"));
      } catch {
        return;
      }

      const rwfs = new ReadWriteFs({ root: tempDir });
      const mfs = new MountableFs();
      mfs.mount("/workspace", rwfs);

      await expect(
        mfs.mkdir("/workspace/mkdir-escape/pwned", { recursive: true }),
      ).rejects.toThrow();

      expect(fs.existsSync(path.join(outsideDir, "pwned"))).toBe(false);
    });

    it("should not traverse symlinks to outside in getAllPaths via mounted OverlayFs", () => {
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "scan-escape"));
      } catch {
        return;
      }

      const ofs = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const mfs = new MountableFs();
      mfs.mount("/overlay", ofs);

      const allPaths = mfs.getAllPaths();
      for (const p of allPaths) {
        expect(p).not.toContain("secret");
      }
    });

    it("should not copy outside content via cp through symlink in mounted OverlayFs", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "cp-escape"));
      } catch {
        return;
      }

      const ofs = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const mfs = new MountableFs();
      mfs.mount("/overlay", ofs);

      await expect(
        mfs.cp("/overlay/cp-escape", "/overlay/stolen.txt"),
      ).rejects.toThrow();
    });
  });

  describe("mount point protection", () => {
    it("should prevent removing mount points", async () => {
      const mounted = new InMemoryFs();
      const mfs = new MountableFs();
      mfs.mount("/mnt/data", mounted);

      await expect(mfs.rm("/mnt/data")).rejects.toThrow("EBUSY");
    });

    it("should prevent removing parent of mount points", async () => {
      const mounted = new InMemoryFs();
      const mfs = new MountableFs();
      mfs.mount("/mnt/data", mounted);

      await expect(mfs.rm("/mnt", { recursive: true })).rejects.toThrow(
        "EBUSY",
      );
    });

    it("should prevent moving mount points", async () => {
      const mounted = new InMemoryFs();
      const mfs = new MountableFs();
      mfs.mount("/mnt/data", mounted);

      await expect(mfs.mv("/mnt/data", "/other")).rejects.toThrow("EBUSY");
    });

    it("should prevent hard links across mount boundaries", async () => {
      const mount1 = new InMemoryFs({ "/file.txt": "content" });
      const mount2 = new InMemoryFs();
      const mfs = new MountableFs();
      mfs.mount("/mnt/a", mount1);
      mfs.mount("/mnt/b", mount2);

      await expect(
        mfs.link("/mnt/a/file.txt", "/mnt/b/link.txt"),
      ).rejects.toThrow("EXDEV");
    });
  });

  describe("readlink through mounts", () => {
    it("should return symlink target from mounted fs", async () => {
      const mounted = new InMemoryFs();
      await mounted.symlink("/target.txt", "/link");

      const mfs = new MountableFs();
      mfs.mount("/mnt", mounted);

      const target = await mfs.readlink("/mnt/link");
      expect(target).toBe("/target.txt");
    });

    it("should throw EINVAL for non-symlink in mount", async () => {
      const mounted = new InMemoryFs({ "/regular.txt": "content" });
      const mfs = new MountableFs();
      mfs.mount("/mnt", mounted);

      await expect(mfs.readlink("/mnt/regular.txt")).rejects.toThrow("EINVAL");
    });
  });

  describe("realpath through mounts", () => {
    it("should resolve realpath within mounted fs", async () => {
      const mounted = new InMemoryFs({
        "/real.txt": "content",
      });
      await mounted.symlink("/real.txt", "/link");

      const mfs = new MountableFs();
      mfs.mount("/mnt", mounted);

      const resolved = await mfs.realpath("/mnt/link");
      expect(resolved).toBe("/mnt/real.txt");
    });

    it("should return mount point for realpath at mount root", async () => {
      const mounted = new InMemoryFs();
      const mfs = new MountableFs();
      mfs.mount("/mnt/data", mounted);

      const resolved = await mfs.realpath("/mnt/data");
      expect(resolved).toBe("/mnt/data");
    });

    it("should throw for broken symlink in realpath", async () => {
      const mounted = new InMemoryFs();
      await mounted.symlink("/nonexistent", "/broken");

      const mfs = new MountableFs();
      mfs.mount("/mnt", mounted);

      await expect(mfs.realpath("/mnt/broken")).rejects.toThrow("ENOENT");
    });
  });
});
