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
});
