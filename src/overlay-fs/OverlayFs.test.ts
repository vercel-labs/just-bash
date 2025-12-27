import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { OverlayFs } from "./OverlayFs.js";

describe("OverlayFs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-fs-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create with valid root directory", () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
      expect(overlay).toBeInstanceOf(OverlayFs);
    });

    it("should throw for non-existent root", () => {
      expect(() => {
        new OverlayFs({ root: "/nonexistent/path/12345" });
      }).toThrow("does not exist");
    });

    it("should throw for file as root", () => {
      const filePath = path.join(tempDir, "file.txt");
      fs.writeFileSync(filePath, "content");
      expect(() => {
        new OverlayFs({ root: filePath });
      }).toThrow("not a directory");
    });
  });

  describe("mount point", () => {
    it("should default to /home/user/project", () => {
      const overlay = new OverlayFs({ root: tempDir });
      expect(overlay.getMountPoint()).toBe("/home/user/project");
    });

    it("should allow custom mount point", () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/app" });
      expect(overlay.getMountPoint()).toBe("/app");
    });

    it("should read files at default mount point", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir });

      const content = await overlay.readFile("/home/user/project/test.txt");
      expect(content).toBe("content");
    });

    it("should not read files outside mount point", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir });

      await expect(overlay.readFile("/test.txt")).rejects.toThrow("ENOENT");
    });

    it("should list files at mount point", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      const overlay = new OverlayFs({ root: tempDir });

      const entries = await overlay.readdir("/home/user/project");
      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
    });

    it("should create mount point parent directories", async () => {
      const overlay = new OverlayFs({ root: tempDir });

      expect(await overlay.exists("/home")).toBe(true);
      expect(await overlay.exists("/home/user")).toBe(true);
      expect(await overlay.exists("/home/user/project")).toBe(true);
    });

    it("should work with BashEnv at mount point", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "hello");
      const overlay = new OverlayFs({ root: tempDir });
      const env = new Bash({ fs: overlay, cwd: overlay.getMountPoint() });

      const result = await env.exec("cat file.txt");
      expect(result.stdout).toBe("hello");
    });
  });

  describe("reading from real filesystem", () => {
    it("should read files from real filesystem", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "real content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      const content = await overlay.readFile("/test.txt");
      expect(content).toBe("real content");
    });

    it("should read nested files", async () => {
      fs.mkdirSync(path.join(tempDir, "subdir"));
      fs.writeFileSync(path.join(tempDir, "subdir", "file.txt"), "nested");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      const content = await overlay.readFile("/subdir/file.txt");
      expect(content).toBe("nested");
    });

    it("should list directory contents from real filesystem", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "subdir"));
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      const entries = await overlay.readdir("/");
      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
      expect(entries).toContain("subdir");
    });

    it("should stat files from real filesystem", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      const stat = await overlay.stat("/test.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(7);
    });
  });

  describe("writing to memory layer", () => {
    it("should write files to memory without affecting real fs", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.writeFile("/new.txt", "memory content");

      // Should read from memory
      const content = await overlay.readFile("/new.txt");
      expect(content).toBe("memory content");

      // Real filesystem should not have the file
      expect(fs.existsSync(path.join(tempDir, "new.txt"))).toBe(false);
    });

    it("should override real files in memory", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "real");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.writeFile("/test.txt", "modified");
      const content = await overlay.readFile("/test.txt");
      expect(content).toBe("modified");

      // Real file should be unchanged
      expect(fs.readFileSync(path.join(tempDir, "test.txt"), "utf8")).toBe(
        "real",
      );
    });

    it("should create directories in memory", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.mkdir("/newdir");
      const stat = await overlay.stat("/newdir");
      expect(stat.isDirectory).toBe(true);

      // Real filesystem should not have the directory
      expect(fs.existsSync(path.join(tempDir, "newdir"))).toBe(false);
    });

    it("should append to files", async () => {
      fs.writeFileSync(path.join(tempDir, "append.txt"), "start");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.appendFile("/append.txt", "-end");
      const content = await overlay.readFile("/append.txt");
      expect(content).toBe("start-end");

      // Real file unchanged
      expect(fs.readFileSync(path.join(tempDir, "append.txt"), "utf8")).toBe(
        "start",
      );
    });
  });

  describe("deletion tracking", () => {
    it("should mark files as deleted", async () => {
      fs.writeFileSync(path.join(tempDir, "delete.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.rm("/delete.txt");

      const exists = await overlay.exists("/delete.txt");
      expect(exists).toBe(false);

      // Real file should still exist
      expect(fs.existsSync(path.join(tempDir, "delete.txt"))).toBe(true);
    });

    it("should hide deleted files from readdir", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.rm("/a.txt");

      const entries = await overlay.readdir("/");
      expect(entries).not.toContain("a.txt");
      expect(entries).toContain("b.txt");
    });

    it("should allow recreating deleted files", async () => {
      fs.writeFileSync(path.join(tempDir, "recreate.txt"), "original");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.rm("/recreate.txt");
      await overlay.writeFile("/recreate.txt", "new content");

      const content = await overlay.readFile("/recreate.txt");
      expect(content).toBe("new content");
    });

    it("should delete directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.writeFileSync(path.join(tempDir, "dir", "file.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.rm("/dir", { recursive: true });

      expect(await overlay.exists("/dir")).toBe(false);
      expect(await overlay.exists("/dir/file.txt")).toBe(false);
    });
  });

  describe("directory merging", () => {
    it("should merge memory and real filesystem entries", async () => {
      fs.writeFileSync(path.join(tempDir, "real.txt"), "real");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.writeFile("/memory.txt", "memory");

      const entries = await overlay.readdir("/");
      expect(entries).toContain("real.txt");
      expect(entries).toContain("memory.txt");
    });

    it("should not duplicate entries", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "real");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      // Override in memory
      await overlay.writeFile("/file.txt", "memory");

      const entries = await overlay.readdir("/");
      const fileCount = entries.filter((e) => e === "file.txt").length;
      expect(fileCount).toBe(1);
    });
  });

  describe("path traversal protection", () => {
    it("should prevent reading outside root with ..", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await expect(overlay.readFile("/../../../etc/passwd")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should normalize paths with .. correctly", async () => {
      fs.mkdirSync(path.join(tempDir, "subdir"));
      fs.writeFileSync(path.join(tempDir, "root.txt"), "root content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      const content = await overlay.readFile("/subdir/../root.txt");
      expect(content).toBe("root content");
    });

    it("should prevent escaping via symlink", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      // Create a symlink in memory that points outside
      await overlay.symlink("/etc/passwd", "/escape-link");

      // Reading should fail because /etc/passwd doesn't exist in our overlay
      await expect(overlay.readFile("/escape-link")).rejects.toThrow("ENOENT");
    });
  });

  describe("symlinks", () => {
    it("should create and read symlinks in memory", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.writeFile("/target.txt", "target content");
      await overlay.symlink("/target.txt", "/link");

      const content = await overlay.readFile("/link");
      expect(content).toBe("target content");
    });

    it("should read symlink target", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.symlink("/target.txt", "/link");
      const target = await overlay.readlink("/link");
      expect(target).toBe("/target.txt");
    });

    it("should lstat symlinks without following", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.symlink("/target.txt", "/link");
      const stat = await overlay.lstat("/link");
      expect(stat.isSymbolicLink).toBe(true);
    });
  });

  describe("copy and move", () => {
    it("should copy files within overlay", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.cp("/source.txt", "/copy.txt");

      const content = await overlay.readFile("/copy.txt");
      expect(content).toBe("content");

      // Real filesystem should not have the copy
      expect(fs.existsSync(path.join(tempDir, "copy.txt"))).toBe(false);
    });

    it("should move files within overlay", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.mv("/source.txt", "/moved.txt");

      expect(await overlay.exists("/source.txt")).toBe(false);
      expect(await overlay.readFile("/moved.txt")).toBe("content");
    });

    it("should copy directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.cp("/srcdir", "/destdir", { recursive: true });

      const content = await overlay.readFile("/destdir/file.txt");
      expect(content).toBe("content");
    });
  });

  describe("chmod", () => {
    it("should change permissions in memory", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.chmod("/file.txt", 0o755);
      const stat = await overlay.stat("/file.txt");
      expect(stat.mode & 0o777).toBe(0o755);
    });
  });

  describe("hard links", () => {
    it("should create hard links in memory", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.writeFile("/original.txt", "content");
      await overlay.link("/original.txt", "/hardlink.txt");

      const content = await overlay.readFile("/hardlink.txt");
      expect(content).toBe("content");
    });
  });

  describe("exists", () => {
    it("should return true for real files", async () => {
      fs.writeFileSync(path.join(tempDir, "real.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      expect(await overlay.exists("/real.txt")).toBe(true);
    });

    it("should return true for memory files", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
      await overlay.writeFile("/memory.txt", "content");

      expect(await overlay.exists("/memory.txt")).toBe(true);
    });

    it("should return false for deleted files", async () => {
      fs.writeFileSync(path.join(tempDir, "deleted.txt"), "content");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      await overlay.rm("/deleted.txt");
      expect(await overlay.exists("/deleted.txt")).toBe(false);
    });

    it("should return false for non-existent files", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
      expect(await overlay.exists("/nonexistent.txt")).toBe(false);
    });
  });

  describe("readOnly mode", () => {
    it("should throw EROFS on writeFile when readOnly is true", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.writeFile("/test.txt", "content")).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on appendFile when readOnly is true", async () => {
      fs.writeFileSync(path.join(tempDir, "existing.txt"), "content");
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.appendFile("/existing.txt", "more")).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on mkdir when readOnly is true", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.mkdir("/newdir")).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on rm when readOnly is true", async () => {
      fs.writeFileSync(path.join(tempDir, "delete.txt"), "content");
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.rm("/delete.txt")).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on cp when readOnly is true", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.cp("/source.txt", "/dest.txt")).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on mv when readOnly is true", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.mv("/source.txt", "/dest.txt")).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on chmod when readOnly is true", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.chmod("/file.txt", 0o755)).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on symlink when readOnly is true", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(overlay.symlink("/target", "/link")).rejects.toThrow(
        "EROFS: read-only file system",
      );
    });

    it("should throw EROFS on link when readOnly is true", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      await expect(
        overlay.link("/source.txt", "/hardlink.txt"),
      ).rejects.toThrow("EROFS: read-only file system");
    });

    it("should allow read operations when readOnly is true", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "content");
      fs.mkdirSync(path.join(tempDir, "subdir"));
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });

      // All read operations should work
      expect(await overlay.readFile("/test.txt")).toBe("content");
      expect(await overlay.exists("/test.txt")).toBe(true);
      expect(await overlay.stat("/test.txt")).toBeDefined();
      expect(await overlay.readdir("/")).toContain("test.txt");
    });

    it("should default to readOnly false", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

      // Should not throw
      await overlay.writeFile("/test.txt", "content");
      expect(await overlay.readFile("/test.txt")).toBe("content");
    });

    it("should work with BashEnv in readOnly mode", async () => {
      fs.writeFileSync(path.join(tempDir, "data.txt"), "hello");
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
      });
      const env = new Bash({ fs: overlay, cwd: "/" });

      // Read should work
      const readResult = await env.exec("cat /data.txt");
      expect(readResult.stdout).toBe("hello");
      expect(readResult.exitCode).toBe(0);

      // Write should fail with EROFS (error is thrown during redirection)
      try {
        await env.exec("echo test > /new.txt");
        expect.fail("Expected EROFS error to be thrown");
      } catch (e) {
        expect(String(e)).toContain("EROFS");
      }
    });
  });

  describe("integration with BashEnv", () => {
    it("should work with BashEnv for basic commands", async () => {
      fs.writeFileSync(path.join(tempDir, "input.txt"), "hello world");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const env = new Bash({ fs: overlay });

      const result = await env.exec("cat /input.txt");
      expect(result.stdout).toBe("hello world");
      expect(result.exitCode).toBe(0);
    });

    it("should allow writing without affecting real fs", async () => {
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const env = new Bash({ fs: overlay });

      await env.exec('echo "new content" > /output.txt');

      const result = await env.exec("cat /output.txt");
      expect(result.stdout).toBe("new content\n");

      // Real fs should not have the file
      expect(fs.existsSync(path.join(tempDir, "output.txt"))).toBe(false);
    });

    it("should work with grep on real files", async () => {
      fs.writeFileSync(path.join(tempDir, "data.txt"), "apple\nbanana\ncherry");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const env = new Bash({ fs: overlay });

      const result = await env.exec("grep banana /data.txt");
      expect(result.stdout).toBe("banana\n");
    });

    it("should work with find on mixed real/memory files", async () => {
      fs.writeFileSync(path.join(tempDir, "real.txt"), "real");
      const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const env = new Bash({ fs: overlay, cwd: "/" });

      await env.exec('echo "memory" > /memory.txt');

      const result = await env.exec('find / -name "*.txt"');
      expect(result.stdout).toContain("real.txt");
      expect(result.stdout).toContain("memory.txt");
    });
  });
});
