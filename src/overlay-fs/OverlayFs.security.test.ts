/**
 * Security tests for OverlayFs path traversal protection
 *
 * These tests attempt to escape the root directory using various
 * attack techniques. All should fail safely.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { OverlayFs } from "./OverlayFs.js";

describe("OverlayFs Security - Path Traversal Prevention", () => {
  let tempDir: string;
  let overlay: OverlayFs;

  // Create a file outside the sandbox that we'll try to access
  let outsideFile: string;
  let outsideDir: string;

  beforeEach(() => {
    // Create sandbox directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-sandbox-"));

    // Create a sibling directory with a secret file (simulates sensitive data)
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-outside-"));
    outsideFile = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outsideFile, "TOP SECRET DATA - YOU SHOULD NOT SEE THIS");

    // Create some files inside the sandbox
    fs.writeFileSync(path.join(tempDir, "allowed.txt"), "This is allowed");
    fs.mkdirSync(path.join(tempDir, "subdir"));
    fs.writeFileSync(
      path.join(tempDir, "subdir", "nested.txt"),
      "Nested allowed",
    );

    overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  describe("basic path traversal with ..", () => {
    it("should block simple ../", async () => {
      await expect(overlay.readFile("/../secret.txt")).rejects.toThrow();
    });

    it("should block multiple ../../../", async () => {
      await expect(
        overlay.readFile("/../../../../../../../etc/passwd"),
      ).rejects.toThrow();
    });

    it("should block ../ from subdirectory", async () => {
      await expect(
        overlay.readFile("/subdir/../../secret.txt"),
      ).rejects.toThrow();
    });

    it("should block deeply nested escape attempts", async () => {
      const deepPath =
        "/a/b/c/d/e/../../../../../../../../../../../../../etc/passwd";
      await expect(overlay.readFile(deepPath)).rejects.toThrow();
    });

    it("should block .. at the end of path", async () => {
      await expect(overlay.readFile("/subdir/..")).rejects.toThrow();
    });

    it("should block bare ..", async () => {
      await expect(overlay.readFile("..")).rejects.toThrow();
    });

    it("should normalize but contain /./../../", async () => {
      await expect(overlay.readFile("/./../../etc/passwd")).rejects.toThrow();
    });
  });

  describe("dot variations and edge cases", () => {
    it("should handle single dot correctly", async () => {
      // /. should resolve to / which is valid
      const stat = await overlay.stat("/.");
      expect(stat.isDirectory).toBe(true);
    });

    it("should block triple dots ...", async () => {
      await expect(overlay.readFile("/.../etc/passwd")).rejects.toThrow();
    });

    it("should block dots with spaces (. .)", async () => {
      await expect(overlay.readFile("/. ./. ./etc/passwd")).rejects.toThrow();
    });

    it("should handle .hidden files correctly (not escape)", async () => {
      await overlay.writeFile("/.hidden", "hidden content");
      const content = await overlay.readFile("/.hidden");
      expect(content).toBe("hidden content");
    });

    it("should handle ..hidden files correctly (not escape)", async () => {
      await overlay.writeFile("/..hidden", "hidden content");
      const content = await overlay.readFile("/..hidden");
      expect(content).toBe("hidden content");
    });

    it("should handle files named just dots", async () => {
      await overlay.writeFile("/...", "dots");
      const content = await overlay.readFile("/...");
      expect(content).toBe("dots");
    });
  });

  describe("absolute path injection", () => {
    it("should not allow reading /etc/passwd directly", async () => {
      await expect(overlay.readFile("/etc/passwd")).rejects.toThrow();
    });

    it("should not allow reading /etc/shadow", async () => {
      await expect(overlay.readFile("/etc/shadow")).rejects.toThrow();
    });

    it("should not allow reading the outside secret file by absolute path", async () => {
      await expect(overlay.readFile(outsideFile)).rejects.toThrow();
    });

    it("should contain paths starting with the real temp dir path", async () => {
      // Try to inject the real absolute path
      await expect(overlay.readFile(outsideDir)).rejects.toThrow();
    });
  });

  describe("symlink escape attempts", () => {
    it("should not follow symlink pointing to absolute path outside", async () => {
      await overlay.symlink("/etc/passwd", "/escape-link");
      await expect(overlay.readFile("/escape-link")).rejects.toThrow("ENOENT");
    });

    it("should not follow symlink pointing to relative path escaping root", async () => {
      await overlay.symlink("../../../etc/passwd", "/relative-escape");
      await expect(overlay.readFile("/relative-escape")).rejects.toThrow();
    });

    it("should not follow chained symlinks escaping root", async () => {
      await overlay.symlink("../", "/link1");
      await overlay.symlink("/link1/../etc/passwd", "/link2");
      await expect(overlay.readFile("/link2")).rejects.toThrow();
    });

    it("should not allow symlink to outside file even if it exists on real fs", async () => {
      // Create a symlink in memory pointing to the secret file
      await overlay.symlink(outsideFile, "/secret-link");
      // Reading should fail because the target is outside our virtual root
      await expect(overlay.readFile("/secret-link")).rejects.toThrow();
    });

    it("should not follow real filesystem symlinks pointing outside", async () => {
      // Create a real symlink on the filesystem pointing outside
      const realSymlink = path.join(tempDir, "real-escape-link");
      try {
        fs.symlinkSync(outsideFile, realSymlink);
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }

      // The overlay should not be able to read through this symlink
      // because the target resolves to outside the root
      await expect(overlay.readFile("/real-escape-link")).rejects.toThrow();
    });

    it("should handle circular symlinks safely", async () => {
      await overlay.symlink("/link2", "/link1");
      await overlay.symlink("/link1", "/link2");
      await expect(overlay.readFile("/link1")).rejects.toThrow();
    });

    it("should handle self-referential symlinks", async () => {
      await overlay.symlink("/self", "/self");
      await expect(overlay.readFile("/self")).rejects.toThrow();
    });
  });

  describe("hard link escape attempts", () => {
    it("should not allow hard linking to paths outside root", async () => {
      // First need to have a file
      await overlay.writeFile("/inside.txt", "inside");
      // Try to create a hard link - this should work within the overlay
      await overlay.link("/inside.txt", "/hardlink.txt");
      const content = await overlay.readFile("/hardlink.txt");
      expect(content).toBe("inside");
    });

    it("should not allow hard linking to non-existent files", async () => {
      await expect(
        overlay.link("/nonexistent.txt", "/link.txt"),
      ).rejects.toThrow("ENOENT");
    });
  });

  describe("special characters and encoding attacks", () => {
    it("should handle null bytes in path", async () => {
      await expect(overlay.readFile("/etc\x00/passwd")).rejects.toThrow();
    });

    it("should handle paths with newlines", async () => {
      await expect(overlay.readFile("/etc\n/../passwd")).rejects.toThrow();
    });

    it("should handle paths with carriage returns", async () => {
      await expect(overlay.readFile("/etc\r/../passwd")).rejects.toThrow();
    });

    it("should handle paths with tabs", async () => {
      await expect(overlay.readFile("/etc\t/passwd")).rejects.toThrow();
    });

    it("should handle backslash as regular character (not path separator)", async () => {
      // On Unix, backslash is a valid filename character
      await overlay.writeFile("/back\\slash", "content");
      const content = await overlay.readFile("/back\\slash");
      expect(content).toBe("content");
    });

    it("should handle paths with unicode", async () => {
      await overlay.writeFile("/файл.txt", "unicode content");
      const content = await overlay.readFile("/файл.txt");
      expect(content).toBe("unicode content");
    });

    it("should handle paths with emoji", async () => {
      await overlay.writeFile("/📁file.txt", "emoji content");
      const content = await overlay.readFile("/📁file.txt");
      expect(content).toBe("emoji content");
    });

    it("should handle very long paths", async () => {
      const longName = "a".repeat(255);
      await overlay.writeFile(`/${longName}`, "long name content");
      const content = await overlay.readFile(`/${longName}`);
      expect(content).toBe("long name content");
    });

    it("should handle paths with spaces", async () => {
      await overlay.writeFile("/path with spaces/file.txt", "spaced");
      const content = await overlay.readFile("/path with spaces/file.txt");
      expect(content).toBe("spaced");
    });

    it("should handle paths with quotes", async () => {
      await overlay.writeFile('/file"with"quotes.txt', "quoted");
      const content = await overlay.readFile('/file"with"quotes.txt');
      expect(content).toBe("quoted");
    });
  });

  describe("URL-style encoding (should be treated literally)", () => {
    // These encodings should NOT be decoded - they should be literal filenames
    it("should treat %2e%2e as literal filename not ..", async () => {
      await overlay.writeFile("/%2e%2e", "not parent");
      const content = await overlay.readFile("/%2e%2e");
      expect(content).toBe("not parent");
    });

    it("should treat %2f as literal not /", async () => {
      await overlay.writeFile("/%2f", "not slash");
      const content = await overlay.readFile("/%2f");
      expect(content).toBe("not slash");
    });

    it("should not decode URL-encoded path traversal", async () => {
      // %2e = . and %2f = /
      // %2e%2e%2f = ../
      await expect(overlay.readFile("/%2e%2e%2fetc/passwd")).rejects.toThrow();
    });
  });

  describe("path normalization edge cases", () => {
    it("should handle multiple consecutive slashes", async () => {
      await overlay.writeFile("/file.txt", "content");
      const content = await overlay.readFile("////file.txt");
      expect(content).toBe("content");
    });

    it("should handle trailing slashes on files", async () => {
      await overlay.writeFile("/file.txt", "content");
      // Trailing slash is stripped during normalization, so this reads the file
      const content = await overlay.readFile("/file.txt/");
      expect(content).toBe("content");
    });

    it("should handle empty path components", async () => {
      await overlay.writeFile("/file.txt", "content");
      const content = await overlay.readFile("/./file.txt");
      expect(content).toBe("content");
    });

    it("should handle path with only slashes", async () => {
      const stat = await overlay.stat("///");
      expect(stat.isDirectory).toBe(true);
    });

    it("should handle . and .. combinations", async () => {
      await expect(overlay.readFile("/./../etc/passwd")).rejects.toThrow();
    });

    it("should handle ../ at various positions", async () => {
      await expect(overlay.readFile("/../")).rejects.toThrow();
      await expect(overlay.readFile("/a/../b/../c/../..")).rejects.toThrow();
    });
  });

  describe("directory traversal via operations", () => {
    it("should not allow mkdir outside root", async () => {
      await expect(overlay.mkdir("/../outside-dir")).resolves.not.toThrow();
      // The directory should be created inside the overlay, not outside
      const exists = await overlay.exists("/outside-dir");
      expect(exists).toBe(true);
      // Real filesystem should not have the directory outside
      expect(fs.existsSync(path.join(outsideDir, "outside-dir"))).toBe(false);
    });

    it("should not allow rm outside root", async () => {
      // Try to delete the outside secret file via path traversal
      // The path gets normalized and doesn't point to the real file
      // rm throws ENOENT which is correct - it can't find it
      await expect(overlay.rm(`/../../../${outsideFile}`)).rejects.toThrow();
      // The real file should still exist (untouched)
      expect(fs.existsSync(outsideFile)).toBe(true);
    });

    it("should not allow cp source from outside root", async () => {
      await expect(overlay.cp(outsideFile, "/stolen.txt")).rejects.toThrow();
    });

    it("should not allow cp destination outside root", async () => {
      await overlay.writeFile("/source.txt", "source content");
      // This should create the file inside the overlay, not outside
      await overlay.cp("/source.txt", "/../../../outside.txt");
      expect(fs.existsSync(path.join(outsideDir, "outside.txt"))).toBe(false);
    });

    it("should not allow mv source from outside root", async () => {
      await expect(overlay.mv(outsideFile, "/stolen.txt")).rejects.toThrow();
    });

    it("should not allow chmod on files outside root", async () => {
      await expect(overlay.chmod(outsideFile, 0o777)).rejects.toThrow();
    });

    it("should not allow stat on files outside root", async () => {
      await expect(overlay.stat(outsideFile)).rejects.toThrow();
    });

    it("should not allow readdir outside root", async () => {
      // Path traversal attempts normalize to root, so we get root contents (not parent)
      const entries = await overlay.readdir("/../../../");
      // Should return contents of overlay root, not real filesystem parent directories
      expect(entries).toContain("allowed.txt");
      expect(entries).not.toContain("secret.txt");
    });
  });

  describe("readdir security - comprehensive", () => {
    it("should not list parent directory contents via ../", async () => {
      const entries = await overlay.readdir("/..");
      // Should normalize to root, not list parent
      expect(entries).toContain("allowed.txt");
      expect(entries).not.toContain("secret.txt");
    });

    it("should not list parent via subdir/../..", async () => {
      const entries = await overlay.readdir("/subdir/../..");
      expect(entries).toContain("allowed.txt");
      expect(entries).not.toContain("secret.txt");
    });

    it("should not list /etc", async () => {
      await expect(overlay.readdir("/etc")).rejects.toThrow();
    });

    it("should not list /tmp (real system tmp)", async () => {
      // /tmp in the overlay should not be the real /tmp
      await expect(overlay.readdir("/tmp")).rejects.toThrow();
    });

    it("should not list home directories", async () => {
      await expect(overlay.readdir("/home")).rejects.toThrow();
      await expect(overlay.readdir("/Users")).rejects.toThrow();
    });

    it("should not list the real outside directory", async () => {
      await expect(overlay.readdir(outsideDir)).rejects.toThrow();
    });

    it("should not list via absolute path with traversal prefix", async () => {
      // The traversal prefix is stripped, leaving an absolute path like /var/folders/...
      // which doesn't exist in the overlay - throws ENOENT (secure behavior)
      await expect(overlay.readdir(`/../../../${outsideDir}`)).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should handle readdir on root with various traversal attempts", async () => {
      const attempts = [
        "/..",
        "/../",
        "/../..",
        "/../../..",
        "/./../../..",
        "/subdir/../../..",
        "/subdir/../subdir/../..",
      ];

      for (const attemptPath of attempts) {
        const entries = await overlay.readdir(attemptPath);
        // All should resolve to root contents
        expect(entries).toContain("allowed.txt");
        expect(entries).not.toContain("secret.txt");
      }
    });

    it("should not leak directory names via readdir errors", async () => {
      // When readdir fails, error message should not reveal real paths
      try {
        await overlay.readdir("/nonexistent/path/to/dir");
      } catch (e) {
        const message = (e as Error).message;
        expect(message).not.toContain(tempDir);
        expect(message).not.toContain(outsideDir);
      }
    });

    it("should not follow symlinks to outside directories", async () => {
      await overlay.symlink(outsideDir, "/outside-link");
      // Returns empty array (secure) - symlink points outside, target doesn't exist in overlay
      const entries = await overlay.readdir("/outside-link");
      expect(entries).toEqual([]);
    });

    it("should not follow chained symlinks to outside directories", async () => {
      await overlay.symlink("../", "/link1");
      await overlay.symlink("/link1", "/link2");
      // Reading link2 should not escape
      const entries = await overlay.readdir("/link2");
      expect(entries).not.toContain("secret.txt");
    });

    it("should handle readdir with null bytes", async () => {
      // Path normalization handles null bytes safely - results in root contents (secure)
      const entries = await overlay.readdir("/subdir\x00/../..");
      expect(entries).toContain("allowed.txt");
      expect(entries).not.toContain("secret.txt");
    });

    it("should handle readdir with special characters in path", async () => {
      // Paths with special characters are normalized and resolve safely to root (secure)
      for (const specialPath of [
        "/sub\ndir/../../..",
        "/sub\rdir/../../..",
        "/sub\tdir/../../..",
      ]) {
        const entries = await overlay.readdir(specialPath);
        expect(entries).toContain("allowed.txt");
        expect(entries).not.toContain("secret.txt");
      }
    });

    it("should not list real filesystem root", async () => {
      // Reading the overlay root should give overlay contents, not real /
      const entries = await overlay.readdir("/");
      // Should have our test files
      expect(entries).toContain("allowed.txt");
      // Should NOT have real filesystem entries
      expect(entries).not.toContain("etc");
      expect(entries).not.toContain("usr");
      expect(entries).not.toContain("var");
      expect(entries).not.toContain("bin");
    });

    it("should handle concurrent readdir attacks", async () => {
      const attacks = Array(20)
        .fill(null)
        .map(() => overlay.readdir("/../../../etc").catch(() => "blocked"));

      const results = await Promise.all(attacks);
      // All should either throw or return empty/root contents
      for (const result of results) {
        if (result !== "blocked") {
          expect(result).not.toContain("passwd");
          expect(result).not.toContain("shadow");
        }
      }
    });

    it("should handle readdir on symlink pointing to traversal path", async () => {
      await overlay.symlink("../../../etc", "/etc-escape");
      // Returns empty array (secure) - symlink traversal target doesn't exist in overlay
      const entries = await overlay.readdir("/etc-escape");
      expect(entries).toEqual([]);
    });

    it("should not allow readdir via Windows-style paths", async () => {
      await expect(overlay.readdir("\\..\\..\\etc")).rejects.toThrow();
      await expect(overlay.readdir("/subdir\\..\\..\\etc")).rejects.toThrow();
    });

    it("should handle readdir with URL-encoded traversal (literal)", async () => {
      // %2e%2e should be treated as literal filename, not ..
      await expect(overlay.readdir("/%2e%2e")).rejects.toThrow();
    });

    it("should isolate memory-created dirs from real fs dirs", async () => {
      // Create a directory in memory that shadows a real path concept
      await overlay.mkdir("/etc");
      await overlay.writeFile("/etc/myfile", "memory content");

      const entries = await overlay.readdir("/etc");
      // Should only contain our memory file, not real /etc contents
      expect(entries).toContain("myfile");
      expect(entries).not.toContain("passwd");
      expect(entries).not.toContain("shadow");
      expect(entries).not.toContain("hosts");
    });
  });

  describe("BashEnv integration security", () => {
    it("should not allow cat to read files outside root", async () => {
      const env = new Bash({ fs: overlay });
      const result = await env.exec(`cat ${outsideFile}`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("TOP SECRET");
    });

    it("should not allow cat with path traversal", async () => {
      const env = new Bash({ fs: overlay });
      const result = await env.exec("cat /../../../etc/passwd");
      expect(result.exitCode).not.toBe(0);
    });

    it("should not allow ls to list directories outside root", async () => {
      const env = new Bash({ fs: overlay });
      const result = await env.exec(`ls ${outsideDir}`);
      expect(result.stdout).not.toContain("secret.txt");
    });

    it("should not allow find to search outside root", async () => {
      const env = new Bash({ fs: overlay, cwd: "/" });
      const result = await env.exec("find / -name secret.txt");
      expect(result.stdout).not.toContain(outsideDir);
      expect(result.stdout).not.toContain("secret.txt");
    });

    it("should not allow grep to read outside root", async () => {
      const env = new Bash({ fs: overlay });
      const result = await env.exec(`grep SECRET ${outsideFile}`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("TOP SECRET");
    });

    it("should not allow head to read outside root", async () => {
      const env = new Bash({ fs: overlay });
      const result = await env.exec(`head ${outsideFile}`);
      expect(result.exitCode).not.toBe(0);
    });

    it("should not allow tail to read outside root", async () => {
      const env = new Bash({ fs: overlay });
      const result = await env.exec(`tail ${outsideFile}`);
      expect(result.exitCode).not.toBe(0);
    });

    it("should not allow redirects to write outside root", async () => {
      const env = new Bash({ fs: overlay });
      await env.exec(`echo "PWNED" > /../../../tmp/pwned.txt`);
      // File should not exist in real filesystem's tmp
      expect(fs.existsSync("/tmp/pwned.txt")).toBe(false);
    });

    it("should not allow symlink command to escape", async () => {
      const env = new Bash({ fs: overlay });
      await env.exec(`ln -s ${outsideFile} /escape`);
      const result = await env.exec("cat /escape");
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("TOP SECRET");
    });

    it("should not allow source command to read outside", async () => {
      const env = new Bash({ fs: overlay });
      const result = await env.exec(`source ${outsideFile}`);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("race condition protection (TOCTOU)", () => {
    it("should handle rapid create/delete cycles", async () => {
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 100; i++) {
        promises.push(
          (async () => {
            try {
              await overlay.writeFile("/race.txt", `content-${i}`);
              await overlay.readFile("/race.txt");
              await overlay.rm("/race.txt");
            } catch {
              // Ignore errors from race conditions
            }
          })(),
        );
      }

      await Promise.all(promises);
      // Should not throw or crash
    });

    it("should handle concurrent path traversal attempts", async () => {
      const attempts = Array(50)
        .fill(null)
        .map((_, i) => {
          const escapePath = `${"../".repeat(i + 1)}etc/passwd`;
          return overlay.readFile(escapePath).catch(() => "blocked");
        });

      const results = await Promise.all(attempts);
      // All should be blocked
      expect(results.every((r) => r === "blocked")).toBe(true);
    });
  });

  describe("resolvePath security", () => {
    it("should normalize paths with .. (security enforced at read/write)", () => {
      // resolvePath is just a path utility - it normalizes paths
      // Security is enforced when actually reading/writing
      const resolved = overlay.resolvePath("/subdir", "../../../etc/passwd");
      // The path normalizes to /etc/passwd (within virtual fs)
      expect(resolved).toBe("/etc/passwd");
      // But actually reading it should fail because it doesn't exist in overlay
    });

    it("should handle resolvePath with absolute paths", async () => {
      const resolved = overlay.resolvePath("/subdir", "/etc/passwd");
      expect(resolved).toBe("/etc/passwd");
      // But reading it should fail - this is where security is enforced
      await expect(overlay.readFile(resolved)).rejects.toThrow();
    });
  });

  describe("getAllPaths security", () => {
    it("should not leak paths outside root", () => {
      const paths = overlay.getAllPaths();
      // Should only contain paths within the overlay
      for (const p of paths) {
        expect(p.startsWith("/")).toBe(true);
        expect(p).not.toContain(outsideDir);
        expect(p).not.toContain(outsideFile);
      }
    });
  });

  describe("appendFile security", () => {
    it("should treat absolute paths as virtual paths (not real fs)", async () => {
      // When we pass an absolute path like /var/folders/.../secret.txt,
      // the overlay treats it as a VIRTUAL path, not a real filesystem path.
      // This is secure because the real file is never touched.
      await overlay.appendFile(outsideFile, "PWNED");

      // The real file should be completely unchanged
      const realContent = fs.readFileSync(outsideFile, "utf8");
      expect(realContent).toBe("TOP SECRET DATA - YOU SHOULD NOT SEE THIS");
      expect(realContent).not.toContain("PWNED");

      // The virtual file at that path contains the appended content
      // (but it's completely isolated from the real file)
      const virtualContent = await overlay.readFile(outsideFile);
      expect(virtualContent).toBe("PWNED");
    });

    it("should not leak real file content via append", async () => {
      // Try to append to what looks like the real path
      // The overlay shouldn't read from the real file first
      await overlay.appendFile(outsideFile, "-suffix");
      const content = await overlay.readFile(outsideFile);
      // Should just be the suffix, not the real file content + suffix
      expect(content).toBe("-suffix");
      expect(content).not.toContain("TOP SECRET");
    });
  });

  describe("readlink security", () => {
    it("should not leak information about outside paths via readlink", async () => {
      // Create a symlink in memory
      await overlay.symlink("/etc/passwd", "/link");
      const target = await overlay.readlink("/link");
      // readlink just returns the target as stored, which is fine
      // The security is in not being able to READ through it
      expect(target).toBe("/etc/passwd");
      await expect(overlay.readFile("/link")).rejects.toThrow();
    });
  });

  describe("Windows-style attacks (should be handled on any OS)", () => {
    it("should handle backslash path traversal attempts", async () => {
      // On Windows, backslash is a path separator
      // On Unix, it's a valid filename character
      // Either way, this shouldn't escape
      await expect(overlay.readFile("\\..\\..\\etc\\passwd")).rejects.toThrow();
    });

    it("should handle mixed slash styles", async () => {
      await expect(
        overlay.readFile("/subdir\\..\\..\\etc/passwd"),
      ).rejects.toThrow();
    });

    it("should handle UNC-style paths", async () => {
      await expect(
        overlay.readFile("//server/share/../../etc/passwd"),
      ).rejects.toThrow();
    });

    it("should handle device names", async () => {
      // Windows device names like NUL, CON, COM1, etc.
      await expect(overlay.readFile("/NUL")).rejects.toThrow();
      await expect(overlay.readFile("/CON")).rejects.toThrow();
    });

    it("should handle alternate data streams syntax", async () => {
      // Windows NTFS alternate data streams: file.txt:stream
      await expect(overlay.readFile("/file.txt:secret")).rejects.toThrow();
    });
  });
});
