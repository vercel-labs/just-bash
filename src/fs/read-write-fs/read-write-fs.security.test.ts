/**
 * Security tests for ReadWriteFs path traversal protection
 *
 * These tests attempt to escape the root directory using various
 * attack techniques. All should fail safely.
 *
 * CRITICAL: Since ReadWriteFs writes directly to the real filesystem,
 * path traversal vulnerabilities could allow attackers to read/write
 * arbitrary files on the system.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs Security - Path Traversal Prevention", () => {
  let tempDir: string;
  let rwfs: ReadWriteFs;

  // Create a file outside the sandbox that we'll try to access
  let outsideFile: string;
  let outsideDir: string;

  beforeEach(() => {
    // Create sandbox directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-sandbox-"));

    // Create a sibling directory with a secret file (simulates sensitive data)
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-outside-"));
    outsideFile = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outsideFile, "TOP SECRET DATA - YOU SHOULD NOT SEE THIS");

    // Create some files inside the sandbox
    fs.writeFileSync(path.join(tempDir, "allowed.txt"), "This is allowed");
    fs.mkdirSync(path.join(tempDir, "subdir"));
    fs.writeFileSync(
      path.join(tempDir, "subdir", "nested.txt"),
      "Nested allowed",
    );

    rwfs = new ReadWriteFs({ root: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  describe("basic path traversal with ..", () => {
    it("should block simple ../", async () => {
      const content = await rwfs.readFile("/../allowed.txt");
      // Path normalizes to /allowed.txt within root
      expect(content).toBe("This is allowed");
    });

    it("should not read files outside root with ../", async () => {
      // Attempting to read outside should fail or read from within root
      await expect(
        rwfs.readFile("/../../../../../../../etc/passwd"),
      ).rejects.toThrow();
    });

    it("should block ../ from subdirectory", async () => {
      // This should read allowed.txt from within root, not escape
      const content = await rwfs.readFile("/subdir/../allowed.txt");
      expect(content).toBe("This is allowed");
    });

    it("should block deeply nested escape attempts", async () => {
      const deepPath =
        "/a/b/c/d/e/../../../../../../../../../../../../../etc/passwd";
      await expect(rwfs.readFile(deepPath)).rejects.toThrow();
    });
  });

  describe("absolute path injection", () => {
    it("should not allow reading /etc/passwd directly", async () => {
      // /etc/passwd as a virtual path should not read the real /etc/passwd
      await expect(rwfs.readFile("/etc/passwd")).rejects.toThrow();
    });

    it("should not allow reading the outside secret file by absolute path", async () => {
      // The absolute path should be treated as a virtual path within root
      await expect(rwfs.readFile(outsideFile)).rejects.toThrow();
    });

    it("should not allow reading outside directory", async () => {
      await expect(rwfs.readFile(outsideDir)).rejects.toThrow();
    });
  });

  describe("write operations security", () => {
    it("should not write files outside root with path traversal", async () => {
      // Try to write outside using path traversal
      await rwfs.writeFile("/../../../tmp/pwned.txt", "PWNED");

      // The file should be created inside root, not in real /tmp
      expect(fs.existsSync("/tmp/pwned.txt")).toBe(false);
      // Should exist within our temp dir
      expect(fs.existsSync(path.join(tempDir, "tmp/pwned.txt"))).toBe(true);
    });

    it("should not allow absolute path to write outside root", async () => {
      const targetPath = path.join(outsideDir, "pwned.txt");
      await rwfs.writeFile(targetPath, "PWNED");

      // The real outside file should not exist
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it("should not allow mkdir outside root", async () => {
      await rwfs.mkdir("/../../../tmp/pwned-dir", { recursive: true });

      // Should not exist in real /tmp
      expect(fs.existsSync("/tmp/pwned-dir")).toBe(false);
    });

    it("should not allow appendFile outside root", async () => {
      // Create file outside and try to append
      await rwfs.appendFile(outsideFile, "PWNED");

      // The real outside file should be unchanged
      const realContent = fs.readFileSync(outsideFile, "utf8");
      expect(realContent).toBe("TOP SECRET DATA - YOU SHOULD NOT SEE THIS");
      expect(realContent).not.toContain("PWNED");
    });
  });

  describe("deletion security", () => {
    it("should not delete files outside root", async () => {
      // Try to delete the outside file
      await expect(rwfs.rm(outsideFile)).rejects.toThrow();

      // The real file should still exist
      expect(fs.existsSync(outsideFile)).toBe(true);
    });

    it("should not delete with path traversal", async () => {
      // Try to delete using traversal
      try {
        await rwfs.rm(`/../../../${outsideFile}`);
      } catch {
        // Expected to fail
      }

      // The real file should still exist
      expect(fs.existsSync(outsideFile)).toBe(true);
    });
  });

  describe("copy and move security", () => {
    it("should not copy from outside root", async () => {
      await expect(rwfs.cp(outsideFile, "/stolen.txt")).rejects.toThrow();
    });

    it("should not copy to outside root", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "source content");

      // This should NOT write to the real outside path
      const targetPath = path.join(outsideDir, "stolen.txt");
      await rwfs.cp("/source.txt", targetPath);

      // Real outside directory should not have the file
      expect(fs.existsSync(targetPath)).toBe(false);
    });

    it("should not move from outside root", async () => {
      await expect(rwfs.mv(outsideFile, "/stolen.txt")).rejects.toThrow();
    });

    it("should not move to outside root", async () => {
      // Create a file to move using rwfs to ensure it exists
      await rwfs.writeFile("/to-move.txt", "move me");

      // Verify file exists via rwfs
      expect(await rwfs.exists("/to-move.txt")).toBe(true);

      const targetPath = path.join(outsideDir, "moved.txt");
      // Note: mv to outside path maps to a deep nested path inside root
      // which may fail with ENOENT if parent dirs don't exist
      await rwfs.mv("/to-move.txt", targetPath);

      // Real outside directory should not have the file
      expect(fs.existsSync(targetPath)).toBe(false);
    });
  });

  describe("stat and chmod security", () => {
    it("should not stat files outside root", async () => {
      await expect(rwfs.stat(outsideFile)).rejects.toThrow();
    });

    it("should not chmod files outside root", async () => {
      await expect(rwfs.chmod(outsideFile, 0o777)).rejects.toThrow();

      // The real file permissions should be unchanged
    });
  });

  describe("readdir security", () => {
    it("should not list directories outside root", async () => {
      await expect(rwfs.readdir(outsideDir)).rejects.toThrow();
    });

    it("should not list /etc", async () => {
      await expect(rwfs.readdir("/etc")).rejects.toThrow();
    });

    it("should not list real system root", async () => {
      // Reading / should give us our sandbox root, not real /
      const entries = await rwfs.readdir("/");
      expect(entries).toContain("allowed.txt");
      expect(entries).not.toContain("etc");
      expect(entries).not.toContain("usr");
      expect(entries).not.toContain("var");
    });

    it("should handle path traversal in readdir", async () => {
      const entries = await rwfs.readdir("/../../../");
      // Should resolve to root of our sandbox
      expect(entries).toContain("allowed.txt");
      expect(entries).not.toContain("etc");
    });
  });

  describe("symlink behavior", () => {
    // ReadWriteFs validates symlink targets to prevent sandbox escapes.
    // All symlink targets are normalized and transformed to point within root.

    it("should create symlinks within root", async () => {
      fs.writeFileSync(path.join(tempDir, "target.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      try {
        await rwfs.symlink("target.txt", "/link");
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }

      const content = await rwfs.readFile("/link");
      expect(content).toBe("content");
    });

    it("should create relative symlinks correctly", async () => {
      // Use a different directory name to avoid conflict with beforeEach's subdir
      fs.mkdirSync(path.join(tempDir, "linkdir"));
      fs.writeFileSync(path.join(tempDir, "linkdir", "file.txt"), "nested");
      const rwfs = new ReadWriteFs({ root: tempDir });

      try {
        await rwfs.symlink("linkdir/file.txt", "/link");
      } catch {
        return;
      }

      const content = await rwfs.readFile("/link");
      expect(content).toBe("nested");
    });

    it("should prevent symlink escape with absolute path", async () => {
      // Attempting to create a symlink to /etc/passwd should NOT allow reading real /etc/passwd
      try {
        await rwfs.symlink("/etc/passwd", "/escape-link");
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }

      // The symlink should point to ${root}/etc/passwd, not real /etc/passwd
      // Since that file doesn't exist within our sandbox, reading should fail
      await expect(rwfs.readFile("/escape-link")).rejects.toThrow("ENOENT");
    });

    it("should prevent symlink escape with relative path traversal", async () => {
      // Attempting to escape via relative path
      try {
        await rwfs.symlink("../../../etc/passwd", "/escape-link2");
      } catch {
        return;
      }

      // The symlink should be transformed to point within root
      // Reading should fail since /etc/passwd doesn't exist in sandbox
      await expect(rwfs.readFile("/escape-link2")).rejects.toThrow("ENOENT");
    });

    it("should prevent reading outside files via symlink to absolute path", async () => {
      // Create symlink pointing to the real outside file's path
      try {
        await rwfs.symlink(outsideFile, "/steal-secret");
      } catch {
        return;
      }

      // Should NOT be able to read the real outside file
      const result = await rwfs.readFile("/steal-secret").catch((e) => e);
      expect(result).toBeInstanceOf(Error);
      // If it somehow succeeded, it must not contain the secret
      if (typeof result === "string") {
        expect(result).not.toContain("TOP SECRET");
      }
    });
  });

  describe("special characters and encoding attacks", () => {
    it("should handle null bytes in path", async () => {
      await expect(rwfs.readFile("/etc\x00/passwd")).rejects.toThrow();
    });

    it("should handle paths with newlines", async () => {
      await expect(rwfs.readFile("/etc\n/../passwd")).rejects.toThrow();
    });

    it("should handle backslash as regular character", async () => {
      // On Unix, backslash is a valid filename character
      await rwfs.writeFile("/back\\slash", "content");
      const content = await rwfs.readFile("/back\\slash");
      expect(content).toBe("content");
    });

    it("should handle unicode filenames safely", async () => {
      await rwfs.writeFile("/файл.txt", "unicode content");
      const content = await rwfs.readFile("/файл.txt");
      expect(content).toBe("unicode content");
    });

    it("should handle emoji filenames", async () => {
      await rwfs.writeFile("/📁file.txt", "emoji content");
      const content = await rwfs.readFile("/📁file.txt");
      expect(content).toBe("emoji content");
    });
  });

  describe("URL-style encoding (should be treated literally)", () => {
    it("should treat %2e%2e as literal filename not ..", async () => {
      await rwfs.writeFile("/%2e%2e", "not parent");
      const content = await rwfs.readFile("/%2e%2e");
      expect(content).toBe("not parent");
    });

    it("should not decode URL-encoded path traversal", async () => {
      // %2e = . and %2f = /
      await expect(rwfs.readFile("/%2e%2e%2fetc/passwd")).rejects.toThrow();
    });
  });

  describe("path normalization edge cases", () => {
    it("should handle multiple consecutive slashes", async () => {
      const content = await rwfs.readFile("////allowed.txt");
      expect(content).toBe("This is allowed");
    });

    it("should handle trailing slashes on files", async () => {
      const content = await rwfs.readFile("/allowed.txt/");
      expect(content).toBe("This is allowed");
    });

    it("should handle . and .. combinations", async () => {
      const content = await rwfs.readFile("/./subdir/../allowed.txt");
      expect(content).toBe("This is allowed");
    });

    it("should handle path with only slashes", async () => {
      const stat = await rwfs.stat("///");
      expect(stat.isDirectory).toBe(true);
    });
  });

  describe("getAllPaths security", () => {
    it("should not leak paths outside root", () => {
      const paths = rwfs.getAllPaths();
      for (const p of paths) {
        expect(p.startsWith("/")).toBe(true);
        expect(p).not.toContain(outsideDir);
        expect(p).not.toContain(outsideFile);
        // Should not contain real system paths
        expect(p).not.toMatch(/^\/etc/);
        expect(p).not.toMatch(/^\/usr/);
        expect(p).not.toMatch(/^\/var/);
      }
    });
  });

  describe("concurrent attack resistance", () => {
    it("should handle concurrent path traversal attempts", async () => {
      const attacks = Array(50)
        .fill(null)
        .map((_, i) => {
          const escapePath = `${"../".repeat(i + 1)}etc/passwd`;
          return rwfs.readFile(escapePath).catch(() => "blocked");
        });

      const results = await Promise.all(attacks);
      // All should be blocked (throw error)
      expect(results.every((r) => r === "blocked")).toBe(true);
    });

    it("should handle concurrent write attempts outside root", async () => {
      const attacks = Array(20)
        .fill(null)
        .map((_, i) =>
          rwfs
            .writeFile(`/../../../tmp/attack-${i}.txt`, "PWNED")
            .catch(() => "blocked"),
        );

      await Promise.all(attacks);

      // No files should exist in real /tmp
      for (let i = 0; i < 20; i++) {
        expect(fs.existsSync(`/tmp/attack-${i}.txt`)).toBe(false);
      }
    });
  });

  describe("Windows-style attacks (should be handled on any OS)", () => {
    it("should handle backslash path traversal attempts", async () => {
      await expect(rwfs.readFile("\\..\\..\\etc\\passwd")).rejects.toThrow();
    });

    it("should handle mixed slash styles", async () => {
      await expect(
        rwfs.readFile("/subdir\\..\\..\\etc/passwd"),
      ).rejects.toThrow();
    });

    it("should handle UNC-style paths", async () => {
      await expect(
        rwfs.readFile("//server/share/../../etc/passwd"),
      ).rejects.toThrow();
    });
  });

  describe("real-world attack scenarios", () => {
    it("should prevent reading SSH keys", async () => {
      await expect(
        rwfs.readFile("/../../../root/.ssh/id_rsa"),
      ).rejects.toThrow();
      await expect(rwfs.readFile("/~/.ssh/id_rsa")).rejects.toThrow();
    });

    it("should prevent reading shadow file", async () => {
      await expect(rwfs.readFile("/../../../etc/shadow")).rejects.toThrow();
    });

    it("should prevent writing to crontab", async () => {
      await rwfs.writeFile("/../../../etc/crontab", "* * * * * evil");
      // Real crontab should not be modified
      // (and shouldn't throw - just writes to sandboxed path)
    });

    it("should prevent modifying bashrc", async () => {
      await rwfs.writeFile("/../../../root/.bashrc", "evil command");
      // Real bashrc should not be modified
    });
  });

  describe("pre-existing OS symlink escape prevention", () => {
    it("should block readFile via pre-existing OS symlink pointing outside", async () => {
      // Simulate a malicious git repo with a pre-existing symlink
      const linkPath = path.join(tempDir, "evil-link");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        return; // Skip on systems that don't support symlinks
      }

      await expect(rwfs.readFile("/evil-link")).rejects.toThrow();
      // Verify the real file was not accessed
      const realContent = fs.readFileSync(outsideFile, "utf8");
      expect(realContent).toBe("TOP SECRET DATA - YOU SHOULD NOT SEE THIS");
    });

    it("should block writeFile via pre-existing OS symlink pointing outside", async () => {
      const linkPath = path.join(tempDir, "write-escape");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        return;
      }

      await expect(rwfs.writeFile("/write-escape", "PWNED")).rejects.toThrow();
      // Verify the real file was not modified
      const realContent = fs.readFileSync(outsideFile, "utf8");
      expect(realContent).toBe("TOP SECRET DATA - YOU SHOULD NOT SEE THIS");
    });

    it("should block stat via pre-existing OS symlink pointing outside", async () => {
      const linkPath = path.join(tempDir, "stat-escape");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        return;
      }

      await expect(rwfs.stat("/stat-escape")).rejects.toThrow();
    });

    it("should block appendFile via pre-existing OS symlink pointing outside", async () => {
      const linkPath = path.join(tempDir, "append-escape");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        return;
      }

      await expect(
        rwfs.appendFile("/append-escape", "PWNED"),
      ).rejects.toThrow();
      const realContent = fs.readFileSync(outsideFile, "utf8");
      expect(realContent).toBe("TOP SECRET DATA - YOU SHOULD NOT SEE THIS");
    });

    it("should block rm via pre-existing OS symlink pointing outside", async () => {
      const linkPath = path.join(tempDir, "rm-escape");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        return;
      }

      await expect(rwfs.rm("/rm-escape")).rejects.toThrow();
      // Verify the real file still exists
      expect(fs.existsSync(outsideFile)).toBe(true);
    });

    it("should block chmod via pre-existing OS symlink pointing outside", async () => {
      const linkPath = path.join(tempDir, "chmod-escape");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        return;
      }

      await expect(rwfs.chmod("/chmod-escape", 0o777)).rejects.toThrow();
    });

    it("should return false for exists via pre-existing OS symlink pointing outside", async () => {
      const linkPath = path.join(tempDir, "exists-escape");
      try {
        fs.symlinkSync(outsideFile, linkPath);
      } catch {
        return;
      }

      expect(await rwfs.exists("/exists-escape")).toBe(false);
    });
  });

  describe("readlink path leak prevention", () => {
    it("should return virtual path instead of real OS path", async () => {
      // Create a file and a symlink to it
      fs.writeFileSync(path.join(tempDir, "target.txt"), "content");
      try {
        fs.symlinkSync(
          path.join(tempDir, "target.txt"),
          path.join(tempDir, "link-to-target"),
        );
      } catch {
        return;
      }

      const target = await rwfs.readlink("/link-to-target");
      // Should NOT contain the real filesystem path
      expect(target).not.toContain(tempDir);
      // Should be a virtual path
      expect(target).toBe("target.txt");
    });

    it("should return virtual path for symlinks in subdirectories", async () => {
      fs.writeFileSync(
        path.join(tempDir, "subdir", "file.txt"),
        "nested content",
      );
      try {
        fs.symlinkSync(
          path.join(tempDir, "subdir", "file.txt"),
          path.join(tempDir, "subdir", "link"),
        );
      } catch {
        return;
      }

      const target = await rwfs.readlink("/subdir/link");
      expect(target).not.toContain(tempDir);
      expect(target).toBe("file.txt");
    });
  });

  describe("mv + symlink escape prevention", () => {
    it("should block mv of symlink that would escape sandbox at destination", async () => {
      // Create a deep directory structure
      fs.mkdirSync(path.join(tempDir, "a", "b", "c"), { recursive: true });

      // Create a relative symlink deep in the tree that is safe at its current location
      // The symlink ../../../ from a/b/c/ resolves to tempDir root (still inside)
      try {
        fs.symlinkSync(
          "../../../allowed.txt",
          path.join(tempDir, "a", "b", "c", "safe-link"),
        );
      } catch {
        return;
      }

      // Moving this symlink to the root would make ../../../ escape the sandbox
      await expect(rwfs.mv("/a/b/c/safe-link", "/escape")).rejects.toThrow();

      // Verify the real file was not modified
      expect(fs.existsSync(outsideFile)).toBe(true);
    });

    it("should allow mv of symlink when target stays within sandbox", async () => {
      fs.mkdirSync(path.join(tempDir, "dir1"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dir2"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "target.txt"), "content");

      try {
        // Create symlink ../target.txt in dir1 (points to tempDir/target.txt)
        fs.symlinkSync("../target.txt", path.join(tempDir, "dir1", "my-link"));
      } catch {
        return;
      }

      // Moving to dir2 - ../target.txt from dir2 still points to tempDir/target.txt (inside sandbox)
      await rwfs.mv("/dir1/my-link", "/dir2/my-link");

      // Should be able to read through the moved symlink
      const content = await rwfs.readFile("/dir2/my-link");
      expect(content).toBe("content");
    });
  });

  describe("realpath escape prevention", () => {
    it("should throw when realpath resolves outside root via symlink", async () => {
      // Create a symlink inside the sandbox pointing outside
      const linkPath = path.join(tempDir, "escape-link");
      fs.symlinkSync(outsideFile, linkPath);

      // realpath should throw, not leak the outside path
      await expect(rwfs.realpath("/escape-link")).rejects.toThrow("ENOENT");
    });

    it("should throw when realpath resolves to parent directory via symlink", async () => {
      const linkPath = path.join(tempDir, "parent-link");
      fs.symlinkSync(outsideDir, linkPath);

      await expect(rwfs.realpath("/parent-link")).rejects.toThrow("ENOENT");
    });

    it("should allow realpath for paths within root", async () => {
      const result = await rwfs.realpath("/allowed.txt");
      expect(result).toBe("/allowed.txt");
    });

    it("should allow realpath for nested paths within root", async () => {
      const result = await rwfs.realpath("/subdir/nested.txt");
      expect(result).toBe("/subdir/nested.txt");
    });
  });

  describe("mkdir escape via pre-existing OS symlink", () => {
    it("should block mkdir through symlink pointing outside", async () => {
      // Create a symlink to outside directory
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "dir-escape"));
      } catch {
        return;
      }

      // Trying to create a subdirectory through the escape symlink should fail
      await expect(
        rwfs.mkdir("/dir-escape/pwned", { recursive: true }),
      ).rejects.toThrow();

      // Verify no directory was created outside
      expect(fs.existsSync(path.join(outsideDir, "pwned"))).toBe(false);
    });

    it("should block mkdir at a path that is a symlink to outside", async () => {
      try {
        fs.symlinkSync(
          path.join(outsideDir, "newdir"),
          path.join(tempDir, "mkdir-escape"),
        );
      } catch {
        return;
      }

      await expect(rwfs.mkdir("/mkdir-escape")).rejects.toThrow();
      expect(fs.existsSync(path.join(outsideDir, "newdir"))).toBe(false);
    });
  });

  describe("getAllPaths symlink leak prevention", () => {
    it("should not follow symlinks to outside directories in getAllPaths", () => {
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "dir-link"));
      } catch {
        return;
      }

      const paths = rwfs.getAllPaths();
      // Should list the symlink itself but NOT traverse into it
      expect(paths).toContain("/dir-link");
      // Should NOT contain any paths from the outside directory
      for (const p of paths) {
        expect(p).not.toContain("secret");
      }
    });

    it("should not follow symlinks to outside files in getAllPaths", () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "file-link"));
      } catch {
        return;
      }

      const paths = rwfs.getAllPaths();
      // Should list the symlink itself
      expect(paths).toContain("/file-link");
      // Should not leak outside paths
      for (const p of paths) {
        expect(p).not.toContain(outsideDir);
      }
    });
  });

  describe("intermediate directory symlink escape", () => {
    it("should block readFile when intermediate directory is symlink to outside", async () => {
      // Create: /subdir -> outsideDir (symlink)
      // Then try to read /subdir/secret.txt
      try {
        // Remove existing subdir first
        fs.rmSync(path.join(tempDir, "escape-dir"), {
          recursive: true,
          force: true,
        });
        fs.symlinkSync(outsideDir, path.join(tempDir, "escape-dir"));
      } catch {
        return;
      }

      await expect(rwfs.readFile("/escape-dir/secret.txt")).rejects.toThrow();
    });

    it("should block writeFile when intermediate directory is symlink to outside", async () => {
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "write-dir-escape"));
      } catch {
        return;
      }

      await expect(
        rwfs.writeFile("/write-dir-escape/pwned.txt", "PWNED"),
      ).rejects.toThrow();

      // Verify nothing was written outside
      expect(fs.existsSync(path.join(outsideDir, "pwned.txt"))).toBe(false);
    });
  });

  describe("symlink creation validation edge cases", () => {
    it("should not create symlink that resolves outside via deeply nested relative", async () => {
      fs.mkdirSync(path.join(tempDir, "a", "b", "c"), { recursive: true });

      // Create symlink at /a/b/c/link -> ../../../../etc/passwd
      // This resolves to outside the root
      try {
        await rwfs.symlink("../../../../etc/passwd", "/a/b/c/link");
      } catch {
        return; // If symlink creation fails, that's also acceptable
      }

      // Even if symlink was created, reading through it should fail
      await expect(rwfs.readFile("/a/b/c/link")).rejects.toThrow();
    });
  });

  describe("symlink creation via parent OS symlink (Finding 6)", () => {
    it("should not create symlink outside sandbox via parent symlink", async () => {
      // Create an OS symlink: root/parent-escape -> outsideDir
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "parent-escape"));
      } catch {
        return;
      }

      // Attempting to create a symlink at /parent-escape/new-link
      // should fail because parent-escape resolves outside sandbox
      await expect(
        rwfs.symlink("target.txt", "/parent-escape/new-link"),
      ).rejects.toThrow();

      // Verify no symlink was created outside
      expect(fs.existsSync(path.join(outsideDir, "new-link"))).toBe(false);
    });
  });

  describe("cp recursive symlink escape prevention (Finding 5)", () => {
    it("should not copy files from outside via symlink during recursive cp", async () => {
      // Create a directory with a symlink pointing outside
      fs.mkdirSync(path.join(tempDir, "src-dir"));
      fs.writeFileSync(path.join(tempDir, "src-dir", "safe.txt"), "safe");
      try {
        fs.symlinkSync(
          outsideFile,
          path.join(tempDir, "src-dir", "escape-link"),
        );
      } catch {
        return;
      }

      // Recursive copy should skip the escape symlink
      await rwfs.cp("/src-dir", "/dest-dir", { recursive: true });

      // safe.txt should be copied
      const safe = await rwfs.readFile("/dest-dir/safe.txt");
      expect(safe).toBe("safe");

      // escape-link should NOT be copied (or should not point outside)
      const destLinkPath = path.join(tempDir, "dest-dir", "escape-link");
      if (fs.existsSync(destLinkPath)) {
        // If it was copied, verify it doesn't point outside
        try {
          const resolved = fs.realpathSync(destLinkPath);
          const canonicalRoot = fs.realpathSync(tempDir);
          expect(
            resolved.startsWith(canonicalRoot) || resolved === canonicalRoot,
          ).toBe(true);
        } catch {
          // ENOENT is fine - broken symlink is safe
        }
      }
    });
  });

  describe("maxFileReadSize bypass via internal symlink (Finding 4)", () => {
    it("should enforce maxFileReadSize through symlinks", async () => {
      // Create a large file inside the sandbox
      const largeContent = "x".repeat(1000);
      fs.writeFileSync(path.join(tempDir, "large.txt"), largeContent);

      // Create a symlink to it
      try {
        fs.symlinkSync(
          path.join(tempDir, "large.txt"),
          path.join(tempDir, "link-to-large"),
        );
      } catch {
        return;
      }

      // Create fs with small maxFileReadSize
      const smallFs = new ReadWriteFs({
        root: tempDir,
        maxFileReadSize: 100,
      });

      // Direct read should be blocked
      await expect(smallFs.readFile("/large.txt")).rejects.toThrow("EFBIG");

      // Read through symlink should also be blocked (not bypass the size check)
      await expect(smallFs.readFile("/link-to-large")).rejects.toThrow("EFBIG");
    });
  });

  describe("mv directory containing escape symlinks (Finding 3)", () => {
    it("should still validate reads after mv of directory with relative symlinks", async () => {
      // Create /deep/dir/ with a relative symlink safe at that depth
      fs.mkdirSync(path.join(tempDir, "deep", "dir"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "deep", "target.txt"), "safe");

      try {
        // ../target.txt from deep/dir/ resolves to deep/target.txt (inside sandbox)
        fs.symlinkSync(
          "../target.txt",
          path.join(tempDir, "deep", "dir", "rel-link"),
        );
      } catch {
        return;
      }

      // Move dir up - the relative symlink now resolves differently
      await rwfs.mv("/deep/dir", "/moved-dir");

      // Reading through the symlink should either work (if target exists) or fail safely
      // It should NOT read files outside the sandbox
      try {
        const content = await rwfs.readFile("/moved-dir/rel-link");
        // If read succeeds, it must have read something inside the sandbox
        expect(content).not.toContain("TOP SECRET");
      } catch {
        // Throwing is also acceptable (ENOENT or EACCES)
      }
    });
  });

  describe("readlink target leak for pre-existing outside symlinks (Finding 17)", () => {
    it("should not leak absolute real path for pre-existing OS symlink pointing outside", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "abs-leak"));
      } catch {
        return;
      }

      const target = await rwfs.readlink("/abs-leak");
      // Should NOT return the full real path like /var/folders/.../secret.txt
      expect(target).not.toBe(outsideFile);
      expect(target).not.toContain(outsideDir);
    });

    it("should return relative target as-is for pre-existing relative symlinks", async () => {
      try {
        fs.symlinkSync(
          "../../../etc/passwd",
          path.join(tempDir, "rel-outside"),
        );
      } catch {
        return;
      }

      const target = await rwfs.readlink("/rel-outside");
      // Relative targets don't leak real paths (they're already relative)
      expect(target).toBe("../../../etc/passwd");
    });
  });

  describe("realpath prefix boundary safety (Finding 18)", () => {
    it("should correctly handle realpath for paths within root", async () => {
      const result = await rwfs.realpath("/allowed.txt");
      expect(result).toBe("/allowed.txt");
    });

    it("should reject symlinks that resolve outside root via realpath", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "rp-escape"));
      } catch {
        return;
      }

      await expect(rwfs.realpath("/rp-escape")).rejects.toThrow("ENOENT");
    });
  });

  describe("error message path leak prevention", () => {
    it("should not leak real root path in ENOENT errors", async () => {
      try {
        await rwfs.readFile("/nonexistent-file-xyz");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(tempDir);
        expect(msg).toContain("/nonexistent-file-xyz");
      }
    });

    it("should not leak real root path in stat errors", async () => {
      try {
        await rwfs.stat("/no-such-path-abc");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(tempDir);
      }
    });

    it("should not leak real root path in mkdir errors", async () => {
      // Create a file then try to mkdir the same path (non-recursive)
      try {
        await rwfs.mkdir("/allowed.txt");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain(tempDir);
      }
    });
  });

  describe("base64 encoding with large files", () => {
    it("should handle base64 read of large file without crashing", async () => {
      const largeContent = "x".repeat(200_000);
      fs.writeFileSync(path.join(tempDir, "large-b64.txt"), largeContent);

      // Should NOT throw RangeError
      const result = await rwfs.readFile("/large-b64.txt", "base64");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("chmod through real-fs symlink to outside", () => {
    it("should block chmod through pre-existing OS symlink to outside file", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "chmod-sym-escape"));
      } catch {
        return;
      }

      await expect(rwfs.chmod("/chmod-sym-escape", 0o755)).rejects.toThrow();
    });
  });

  describe("utimes through real-fs symlink to outside", () => {
    it("should block utimes through pre-existing OS symlink to outside file", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "utimes-sym-escape"));
      } catch {
        return;
      }

      const now = new Date();
      await expect(
        rwfs.utimes("/utimes-sym-escape", now, now),
      ).rejects.toThrow();
    });
  });

  describe("cp through real-fs symlink to outside", () => {
    it("should block cp of file through pre-existing OS symlink to outside", async () => {
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "cp-sym-escape"));
      } catch {
        return;
      }

      await expect(rwfs.cp("/cp-sym-escape", "/stolen.txt")).rejects.toThrow();
    });
  });
});
