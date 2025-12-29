import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "read-write-fs-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create with valid root directory", () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      expect(rwfs).toBeInstanceOf(ReadWriteFs);
    });

    it("should throw for non-existent root", () => {
      expect(() => {
        new ReadWriteFs({ root: "/nonexistent/path/12345" });
      }).toThrow("does not exist");
    });

    it("should throw for file as root", () => {
      const filePath = path.join(tempDir, "file.txt");
      fs.writeFileSync(filePath, "content");
      expect(() => {
        new ReadWriteFs({ root: filePath });
      }).toThrow("not a directory");
    });
  });

  describe("reading files", () => {
    it("should read files from filesystem", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "real content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      const content = await rwfs.readFile("/test.txt");
      expect(content).toBe("real content");
    });

    it("should read nested files", async () => {
      fs.mkdirSync(path.join(tempDir, "subdir"));
      fs.writeFileSync(path.join(tempDir, "subdir", "file.txt"), "nested");
      const rwfs = new ReadWriteFs({ root: tempDir });

      const content = await rwfs.readFile("/subdir/file.txt");
      expect(content).toBe("nested");
    });

    it("should read files as buffer", async () => {
      const data = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      fs.writeFileSync(path.join(tempDir, "binary.bin"), data);
      const rwfs = new ReadWriteFs({ root: tempDir });

      const buffer = await rwfs.readFileBuffer("/binary.bin");
      expect(buffer).toEqual(new Uint8Array(data));
    });

    it("should throw ENOENT for non-existent file", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.readFile("/nonexistent.txt")).rejects.toThrow("ENOENT");
    });

    it("should throw EISDIR when reading a directory", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.readFile("/dir")).rejects.toThrow("EISDIR");
    });
  });

  describe("writing files", () => {
    it("should write files to filesystem", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.writeFile("/new.txt", "new content");

      // Should read back from filesystem
      const content = await rwfs.readFile("/new.txt");
      expect(content).toBe("new content");

      // Real filesystem should have the file
      expect(fs.readFileSync(path.join(tempDir, "new.txt"), "utf8")).toBe(
        "new content",
      );
    });

    it("should create parent directories when writing", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.writeFile("/deep/nested/file.txt", "content");

      expect(fs.existsSync(path.join(tempDir, "deep/nested/file.txt"))).toBe(
        true,
      );
    });

    it("should overwrite existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "original");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.writeFile("/test.txt", "modified");

      expect(fs.readFileSync(path.join(tempDir, "test.txt"), "utf8")).toBe(
        "modified",
      );
    });

    it("should write binary content", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff]);

      await rwfs.writeFile("/binary.bin", data);

      const written = fs.readFileSync(path.join(tempDir, "binary.bin"));
      expect(new Uint8Array(written)).toEqual(data);
    });
  });

  describe("appending files", () => {
    it("should append to existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "append.txt"), "start");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.appendFile("/append.txt", "-end");

      expect(fs.readFileSync(path.join(tempDir, "append.txt"), "utf8")).toBe(
        "start-end",
      );
    });

    it("should create file if it does not exist", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.appendFile("/new.txt", "content");

      expect(fs.readFileSync(path.join(tempDir, "new.txt"), "utf8")).toBe(
        "content",
      );
    });
  });

  describe("exists", () => {
    it("should return true for existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "exists.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      expect(await rwfs.exists("/exists.txt")).toBe(true);
    });

    it("should return true for existing directories", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir });

      expect(await rwfs.exists("/dir")).toBe(true);
    });

    it("should return false for non-existent paths", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      expect(await rwfs.exists("/nonexistent")).toBe(false);
    });
  });

  describe("stat", () => {
    it("should stat files", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      const stat = await rwfs.stat("/file.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(7);
    });

    it("should stat directories", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir });

      const stat = await rwfs.stat("/dir");
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });

    it("should throw ENOENT for non-existent paths", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.stat("/nonexistent")).rejects.toThrow("ENOENT");
    });
  });

  describe("lstat", () => {
    it("should lstat symlinks without following", async () => {
      fs.writeFileSync(path.join(tempDir, "target.txt"), "content");
      try {
        fs.symlinkSync(
          path.join(tempDir, "target.txt"),
          path.join(tempDir, "link"),
        );
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir });

      const stat = await rwfs.lstat("/link");
      expect(stat.isSymbolicLink).toBe(true);
    });
  });

  describe("mkdir", () => {
    it("should create directories", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.mkdir("/newdir");

      expect(fs.statSync(path.join(tempDir, "newdir")).isDirectory()).toBe(
        true,
      );
    });

    it("should create nested directories with recursive option", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.mkdir("/a/b/c", { recursive: true });

      expect(fs.statSync(path.join(tempDir, "a/b/c")).isDirectory()).toBe(true);
    });

    it("should throw ENOENT without recursive for missing parent", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      await expect(rwfs.mkdir("/missing/dir")).rejects.toThrow("ENOENT");
    });

    it("should throw EEXIST for existing directory without recursive", async () => {
      fs.mkdirSync(path.join(tempDir, "existing"));
      const rwfs = new ReadWriteFs({ root: tempDir });

      await expect(rwfs.mkdir("/existing")).rejects.toThrow("EEXIST");
    });
  });

  describe("readdir", () => {
    it("should list directory contents", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "subdir"));
      const rwfs = new ReadWriteFs({ root: tempDir });

      const entries = await rwfs.readdir("/");
      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
      expect(entries).toContain("subdir");
    });

    it("should throw ENOENT for non-existent directory", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.readdir("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw ENOTDIR for files", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.readdir("/file.txt")).rejects.toThrow("ENOTDIR");
    });
  });

  describe("rm", () => {
    it("should delete files", async () => {
      fs.writeFileSync(path.join(tempDir, "delete.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.rm("/delete.txt");

      expect(fs.existsSync(path.join(tempDir, "delete.txt"))).toBe(false);
    });

    it("should delete directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.writeFileSync(path.join(tempDir, "dir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.rm("/dir", { recursive: true });

      expect(fs.existsSync(path.join(tempDir, "dir"))).toBe(false);
    });

    it("should throw ENOENT without force option", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.rm("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should not throw with force option for non-existent files", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(
        rwfs.rm("/nonexistent", { force: true }),
      ).resolves.not.toThrow();
    });
  });

  describe("cp", () => {
    it("should copy files", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.cp("/source.txt", "/dest.txt");

      expect(fs.readFileSync(path.join(tempDir, "dest.txt"), "utf8")).toBe(
        "content",
      );
    });

    it("should copy directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.cp("/srcdir", "/destdir", { recursive: true });

      expect(
        fs.readFileSync(path.join(tempDir, "destdir", "file.txt"), "utf8"),
      ).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.cp("/nonexistent", "/dest")).rejects.toThrow("ENOENT");
    });
  });

  describe("mv", () => {
    it("should move files", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.mv("/source.txt", "/dest.txt");

      expect(fs.existsSync(path.join(tempDir, "source.txt"))).toBe(false);
      expect(fs.readFileSync(path.join(tempDir, "dest.txt"), "utf8")).toBe(
        "content",
      );
    });

    it("should move directories", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.mv("/srcdir", "/destdir");

      expect(fs.existsSync(path.join(tempDir, "srcdir"))).toBe(false);
      expect(
        fs.readFileSync(path.join(tempDir, "destdir", "file.txt"), "utf8"),
      ).toBe("content");
    });
  });

  describe("chmod", () => {
    it("should change file permissions", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.chmod("/file.txt", 0o755);

      const stat = fs.statSync(path.join(tempDir, "file.txt"));
      expect(stat.mode & 0o777).toBe(0o755);
    });

    it("should throw ENOENT for non-existent file", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.chmod("/nonexistent", 0o755)).rejects.toThrow("ENOENT");
    });
  });

  describe("symlink", () => {
    it("should create symbolic links", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      try {
        await rwfs.symlink("target.txt", "/link");
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }

      const target = fs.readlinkSync(path.join(tempDir, "link"));
      expect(target).toBe("target.txt");
    });

    it("should throw EEXIST for existing path", async () => {
      fs.writeFileSync(path.join(tempDir, "existing"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await expect(rwfs.symlink("target", "/existing")).rejects.toThrow(
        "EEXIST",
      );
    });
  });

  describe("link", () => {
    it("should create hard links", async () => {
      fs.writeFileSync(path.join(tempDir, "original.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.link("/original.txt", "/hardlink.txt");

      const content = fs.readFileSync(
        path.join(tempDir, "hardlink.txt"),
        "utf8",
      );
      expect(content).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.link("/nonexistent", "/link")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should throw EEXIST for existing destination", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      fs.writeFileSync(path.join(tempDir, "existing.txt"), "existing");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await expect(rwfs.link("/source.txt", "/existing.txt")).rejects.toThrow(
        "EEXIST",
      );
    });
  });

  describe("readlink", () => {
    it("should read symlink target", async () => {
      try {
        fs.symlinkSync("target.txt", path.join(tempDir, "link"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir });

      const target = await rwfs.readlink("/link");
      expect(target).toBe("target.txt");
    });

    it("should throw ENOENT for non-existent symlink", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      await expect(rwfs.readlink("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw EINVAL for non-symlink", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await expect(rwfs.readlink("/file.txt")).rejects.toThrow("EINVAL");
    });
  });

  describe("resolvePath", () => {
    it("should resolve relative paths", () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      expect(rwfs.resolvePath("/dir", "file.txt")).toBe("/dir/file.txt");
      expect(rwfs.resolvePath("/dir", "../file.txt")).toBe("/file.txt");
    });

    it("should handle absolute paths", () => {
      const rwfs = new ReadWriteFs({ root: tempDir });

      expect(rwfs.resolvePath("/dir", "/other/file.txt")).toBe(
        "/other/file.txt",
      );
    });
  });

  describe("getAllPaths", () => {
    it("should return all paths in filesystem", () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.mkdirSync(path.join(tempDir, "subdir"));
      fs.writeFileSync(path.join(tempDir, "subdir", "b.txt"), "b");
      const rwfs = new ReadWriteFs({ root: tempDir });

      const paths = rwfs.getAllPaths();
      expect(paths).toContain("/a.txt");
      expect(paths).toContain("/subdir");
      expect(paths).toContain("/subdir/b.txt");
    });
  });

  describe("encoding support", () => {
    it("should write and read with base64 encoding", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      const base64Content = btoa("Hello World");

      await rwfs.writeFile("/base64.txt", base64Content, "base64");
      const content = await rwfs.readFile("/base64.txt");
      expect(content).toBe("Hello World");
    });

    it("should write and read with hex encoding", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      const hexContent = "48656c6c6f"; // "Hello"

      await rwfs.writeFile("/hex.txt", hexContent, "hex");
      const content = await rwfs.readFile("/hex.txt");
      expect(content).toBe("Hello");
    });
  });
});
