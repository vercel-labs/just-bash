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
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      expect(rwfs).toBeInstanceOf(ReadWriteFs);
    });

    it("should throw for non-existent root", () => {
      expect(() => {
        new ReadWriteFs({
          root: "/nonexistent/path/12345",
          allowSymlinks: true,
        });
      }).toThrow("does not exist");
    });

    it("should throw for file as root", () => {
      const filePath = path.join(tempDir, "file.txt");
      fs.writeFileSync(filePath, "content");
      expect(() => {
        new ReadWriteFs({ root: filePath, allowSymlinks: true });
      }).toThrow("not a directory");
    });
  });

  describe("reading files", () => {
    it("should read files from filesystem", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "real content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const content = await rwfs.readFile("/test.txt");
      expect(content).toBe("real content");
    });

    it("should read nested files", async () => {
      fs.mkdirSync(path.join(tempDir, "subdir"));
      fs.writeFileSync(path.join(tempDir, "subdir", "file.txt"), "nested");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const content = await rwfs.readFile("/subdir/file.txt");
      expect(content).toBe("nested");
    });

    it("should read files as buffer", async () => {
      const data = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      fs.writeFileSync(path.join(tempDir, "binary.bin"), data);
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const buffer = await rwfs.readFileBuffer("/binary.bin");
      expect(buffer).toEqual(new Uint8Array(data));
    });

    it("should throw ENOENT for non-existent file", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readFile("/nonexistent.txt")).rejects.toThrow("ENOENT");
    });

    it("should throw EISDIR when reading a directory", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readFile("/dir")).rejects.toThrow("EISDIR");
    });
  });

  describe("writing files", () => {
    it("should write files to filesystem", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

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
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/deep/nested/file.txt", "content");

      expect(fs.existsSync(path.join(tempDir, "deep/nested/file.txt"))).toBe(
        true,
      );
    });

    it("should overwrite existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "original");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/test.txt", "modified");

      expect(fs.readFileSync(path.join(tempDir, "test.txt"), "utf8")).toBe(
        "modified",
      );
    });

    it("should overwrite a private writable file without replacing its directory entry", async () => {
      const dirPath = path.join(tempDir, "non-writable-dir");
      const filePath = path.join(dirPath, "writable.txt");
      fs.mkdirSync(dirPath);
      fs.writeFileSync(filePath, "original");
      fs.chmodSync(filePath, 0o666);
      fs.chmodSync(dirPath, 0o555);
      const rwfs = new ReadWriteFs({ root: tempDir });

      try {
        await rwfs.writeFile("/non-writable-dir/writable.txt", "modified");

        expect(fs.readFileSync(filePath, "utf8")).toBe("modified");
      } finally {
        fs.chmodSync(dirPath, 0o755);
      }
    });

    it("should write binary content", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff]);

      await rwfs.writeFile("/binary.bin", data);

      const written = fs.readFileSync(path.join(tempDir, "binary.bin"));
      expect(new Uint8Array(written)).toEqual(data);
    });
  });

  describe("appending files", () => {
    it("should append to existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "append.txt"), "start");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.appendFile("/append.txt", "-end");

      expect(fs.readFileSync(path.join(tempDir, "append.txt"), "utf8")).toBe(
        "start-end",
      );
    });

    it("should create file if it does not exist", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.appendFile("/new.txt", "content");

      expect(fs.readFileSync(path.join(tempDir, "new.txt"), "utf8")).toBe(
        "content",
      );
    });
  });

  describe("exists", () => {
    it("should return true for existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "exists.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      expect(await rwfs.exists("/exists.txt")).toBe(true);
    });

    it("should return true for existing directories", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      expect(await rwfs.exists("/dir")).toBe(true);
    });

    it("should return false for non-existent paths", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      expect(await rwfs.exists("/nonexistent")).toBe(false);
    });
  });

  describe("stat", () => {
    it("should stat files", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const stat = await rwfs.stat("/file.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(7);
    });

    it("should stat directories", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const stat = await rwfs.stat("/dir");
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });

    it("should throw ENOENT for non-existent paths", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.stat("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw ENOTDIR (not 'outside sandbox') when a file is traversed as a directory (fixes #745)", async () => {
      fs.writeFileSync(path.join(tempDir, "notes.txt"), "hello\n");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.stat("/notes.txt/child")).rejects.toThrow("ENOTDIR");
      await expect(rwfs.stat("/notes.txt/child")).rejects.not.toThrow(
        "outside sandbox",
      );
    });

    it("should throw ELOOP (not 'outside sandbox') for a symlink loop (fixes #745)", async () => {
      try {
        fs.symlinkSync("loop-b", path.join(tempDir, "loop-a"));
        fs.symlinkSync("loop-a", path.join(tempDir, "loop-b"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.stat("/loop-a")).rejects.toThrow("ELOOP");
      await expect(rwfs.stat("/loop-a")).rejects.not.toThrow("outside sandbox");
    });

    it("should not surface ENOTDIR for a failure past a symlink that escapes the root (review #767)", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.writeFileSync(path.join(outsideDir, "shadow"), "secret");
        try {
          fs.symlinkSync(outsideDir, path.join(tempDir, "escape-link"));
        } catch {
          // Skip on systems that don't support symlinks
          return;
        }
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/escape-link/shadow/child")).rejects.toThrow(
          "outside sandbox",
        );
        await expect(
          rwfs.stat("/escape-link/shadow/child"),
        ).rejects.not.toThrow("ENOTDIR");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it.each([
      "file",
      "directory",
    ])("rejects an escaping symlink target with a parent component through an outside %s", async (kind) => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        const outside = path.join(outsideDir, "target");
        if (kind === "file") {
          fs.writeFileSync(outside, "secret");
        } else {
          fs.mkdirSync(outside);
        }
        fs.symlinkSync(outside, path.join(tempDir, "b"));
        fs.symlinkSync("b/../missing", path.join(tempDir, "a"));

        for (const allowSymlinks of [false, true]) {
          const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks });
          let caught: unknown;
          try {
            await rwfs.stat("/a");
          } catch (error) {
            caught = error;
          }
          expect((caught as Error).message).toBe(
            "EACCES: permission denied, '/a' resolves outside sandbox",
          );
          expect((caught as NodeJS.ErrnoException).code).toBeUndefined();
        }
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it.each([
      "file",
      "directory",
    ])("rejects an outside %s reached after a nested link and parent traversal", async (kind) => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.mkdirSync(path.join(tempDir, "deep", "child"), { recursive: true });
        fs.mkdirSync(path.join(tempDir, "dir"));
        fs.symlinkSync("../deep/child", path.join(tempDir, "dir", "link"));
        fs.symlinkSync("dir/link", path.join(tempDir, "b"));
        fs.symlinkSync(outsideDir, path.join(tempDir, "deep", "probe"));
        fs.symlinkSync("b/../probe/secret/child", path.join(tempDir, "a"));
        if (kind === "file") {
          fs.writeFileSync(path.join(outsideDir, "secret"), "secret");
        } else {
          fs.mkdirSync(path.join(outsideDir, "secret"));
        }
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/a")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("preserves ENOTDIR after an in-root nested link and parent traversal", async () => {
      fs.mkdirSync(path.join(tempDir, "deep", "child"), { recursive: true });
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.symlinkSync("../deep/child", path.join(tempDir, "dir", "link"));
      fs.symlinkSync("dir/link", path.join(tempDir, "b"));
      fs.writeFileSync(path.join(tempDir, "deep", "file"), "content");
      fs.symlinkSync("b/../file/child", path.join(tempDir, "a"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.stat("/a")).rejects.toThrow("ENOTDIR");
    });

    it("rejects an outside lookup behind a self-referential normalized target", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "b"));
        fs.symlinkSync("a/../b/file/child", path.join(tempDir, "a"));
        fs.writeFileSync(path.join(outsideDir, "file"), "secret");
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/a")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects an outside lookup hidden behind a repeated normalized link", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.symlinkSync(outsideDir, path.join(tempDir, "out"));
        fs.symlinkSync("b/file", path.join(tempDir, "a"));
        fs.symlinkSync("missing/../a/../out", path.join(tempDir, "b"));
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/a")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it.each([
      "file",
      "directory",
    ])("does not expose an outside %s reached after a missing normalized parent", async (kind) => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-parent-"));
      try {
        const root = path.join(parent, "root");
        const outside = path.join(parent, "outside");
        fs.mkdirSync(root);
        fs.mkdirSync(outside);
        if (kind === "file") {
          fs.writeFileSync(path.join(outside, "secret"), "secret");
        } else {
          fs.mkdirSync(path.join(outside, "secret"));
        }
        fs.symlinkSync(
          "missing/../../outside/secret/child",
          path.join(root, "a"),
        );
        const rwfs = new ReadWriteFs({ root, allowSymlinks: true });

        await expect(rwfs.stat("/a")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    });

    it("does not reject a dangling symlink whose parent traversal stays inside the root", async () => {
      fs.mkdirSync(path.join(tempDir, "nested", "dir"), { recursive: true });
      fs.symlinkSync("dir/../missing", path.join(tempDir, "nested", "a"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/nested/a", "created");

      expect(
        fs.readFileSync(path.join(tempDir, "nested", "missing"), "utf8"),
      ).toBe("created");
    });

    it("preserves ENOTDIR when a link traverses an in-root file before '..'", async () => {
      fs.writeFileSync(path.join(tempDir, "file"), "content");
      fs.symlinkSync("file/../missing", path.join(tempDir, "link"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.stat("/link")).rejects.toThrow("ENOTDIR");
    });

    it("rejects a symlink that leaves the root before returning to it", async () => {
      const target = `../${path.basename(tempDir)}/missing`;
      fs.symlinkSync(target, path.join(tempDir, "a"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.stat("/a")).rejects.toThrow(
        "EACCES: permission denied, '/a' resolves outside sandbox",
      );
      await expect(rwfs.realpath("/a")).rejects.toThrow("ENOENT");
    });

    it("does not expose an outside lookup after a file and '..' in a symlink target", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.writeFileSync(path.join(outsideDir, "secret"), "secret");
        fs.writeFileSync(path.join(tempDir, "file"), "local");
        fs.mkdirSync(path.join(tempDir, "dir"));
        fs.symlinkSync(outsideDir, path.join(tempDir, "out"));
        fs.symlinkSync("file/../out/secret/child", path.join(tempDir, "a"));
        fs.symlinkSync("dir/../out/secret/child", path.join(tempDir, "b"));
        fs.symlinkSync("file", path.join(tempDir, "inner-file"));
        fs.symlinkSync("dir", path.join(tempDir, "inner-dir"));
        fs.symlinkSync(
          "inner-file/../out/secret/child",
          path.join(tempDir, "c"),
        );
        fs.symlinkSync(
          "inner-dir/../out/secret/child",
          path.join(tempDir, "d"),
        );
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        for (const name of ["a", "b", "c", "d"]) {
          for (const suffix of ["", "/child"]) {
            await expect(rwfs.stat(`/${name}${suffix}`)).rejects.toThrow(
              `EACCES: permission denied, '/${name}${suffix}' resolves outside sandbox`,
            );
          }
        }
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects an outside lookup after a symlink target normalizes another failed target", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.writeFileSync(path.join(outsideDir, "secret"), "secret");
        fs.symlinkSync(outsideDir, path.join(tempDir, "out"));
        fs.writeFileSync(path.join(tempDir, "file"), "local");
        fs.symlinkSync("file/child", path.join(tempDir, "inner"));
        fs.symlinkSync("inner/../out/secret/child", path.join(tempDir, "a"));
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/a")).rejects.toThrow(
          "EACCES: permission denied, '/a' resolves outside sandbox",
        );
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("should fall back to the generic rejection for a symlink loop when symlinks are disallowed (review #767)", async () => {
      try {
        fs.symlinkSync("loop-b", path.join(tempDir, "loop-a"));
        fs.symlinkSync("loop-a", path.join(tempDir, "loop-b"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir });

      await expect(rwfs.stat("/loop-a")).rejects.toThrow("outside sandbox");
      await expect(rwfs.stat("/loop-a")).rejects.not.toThrow("ELOOP");
    });

    it("should not surface ELOOP for a loop outside the root (review #767)", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        try {
          fs.symlinkSync("loop", path.join(outsideDir, "loop"));
          fs.symlinkSync(outsideDir, path.join(tempDir, "chain"));
        } catch {
          // Skip on systems that don't support symlinks
          return;
        }
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/chain/loop")).rejects.toThrow(
          "outside sandbox",
        );
        await expect(rwfs.stat("/chain/loop")).rejects.not.toThrow("ELOOP");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe("realpath", () => {
    it("should keep ENOTDIR for a file traversed as a directory (review #767)", async () => {
      fs.writeFileSync(path.join(tempDir, "notes.txt"), "hello\n");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.realpath("/notes.txt/child")).rejects.toThrow(
        "ENOTDIR",
      );
    });

    it("should keep ELOOP for a symlink loop (review #767)", async () => {
      try {
        fs.symlinkSync("loop-b", path.join(tempDir, "loop-a"));
        fs.symlinkSync("loop-a", path.join(tempDir, "loop-b"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.realpath("/loop-a")).rejects.toThrow("ELOOP");
    });

    it("should still map genuine sandbox rejections to ENOENT (review #767)", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.writeFileSync(path.join(outsideDir, "shadow"), "secret");
        try {
          fs.symlinkSync(outsideDir, path.join(tempDir, "escape-link"));
        } catch {
          // Skip on systems that don't support symlinks
          return;
        }
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(
          rwfs.realpath("/escape-link/shadow/child"),
        ).rejects.toThrow("ENOENT");
        await expect(rwfs.realpath("/nonexistent")).rejects.toThrow("ENOENT");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
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
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const stat = await rwfs.lstat("/link");
      expect(stat.isSymbolicLink).toBe(true);
    });
  });

  describe("mkdir", () => {
    it("should create directories", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.mkdir("/newdir");

      expect(fs.statSync(path.join(tempDir, "newdir")).isDirectory()).toBe(
        true,
      );
    });

    it("should create nested directories with recursive option", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.mkdir("/a/b/c", { recursive: true });

      expect(fs.statSync(path.join(tempDir, "a/b/c")).isDirectory()).toBe(true);
    });

    it("should throw ENOENT without recursive for missing parent", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.mkdir("/missing/dir")).rejects.toThrow("ENOENT");
    });

    it("should throw EEXIST for existing directory without recursive", async () => {
      fs.mkdirSync(path.join(tempDir, "existing"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.mkdir("/existing")).rejects.toThrow("EEXIST");
    });
  });

  describe("readdir", () => {
    it("should list directory contents", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "subdir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const entries = await rwfs.readdir("/");
      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
      expect(entries).toContain("subdir");
    });

    it("should throw ENOENT for non-existent directory", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readdir("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw ENOTDIR for files", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readdir("/file.txt")).rejects.toThrow("ENOTDIR");
    });
  });

  describe("rm", () => {
    it("should delete files", async () => {
      fs.writeFileSync(path.join(tempDir, "delete.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.rm("/delete.txt");

      expect(fs.existsSync(path.join(tempDir, "delete.txt"))).toBe(false);
    });

    it("should delete directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.writeFileSync(path.join(tempDir, "dir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.rm("/dir", { recursive: true });

      expect(fs.existsSync(path.join(tempDir, "dir"))).toBe(false);
    });

    it("should throw ENOENT without force option", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.rm("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should not throw with force option for non-existent files", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(
        rwfs.rm("/nonexistent", { force: true }),
      ).resolves.not.toThrow();
    });
  });

  describe("cp", () => {
    it("should copy files", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.cp("/source.txt", "/dest.txt");

      expect(fs.readFileSync(path.join(tempDir, "dest.txt"), "utf8")).toBe(
        "content",
      );
    });

    it("should copy directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.cp("/srcdir", "/destdir", { recursive: true });

      expect(
        fs.readFileSync(path.join(tempDir, "destdir", "file.txt"), "utf8"),
      ).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.cp("/nonexistent", "/dest")).rejects.toThrow("ENOENT");
    });

    it("should keep the failing destination path and .code when a recursive copy hits a symlink loop (review #767)", async () => {
      fs.mkdirSync(path.join(tempDir, "src"));
      fs.writeFileSync(path.join(tempDir, "src", "file"), "data");
      fs.mkdirSync(path.join(tempDir, "dst"));
      try {
        fs.symlinkSync("file", path.join(tempDir, "dst", "file"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      let caught: unknown;
      try {
        await rwfs.cp("/src", "/dst", { recursive: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain("ELOOP");
      expect((caught as Error).message).toContain("/dst/file");
      expect((caught as NodeJS.ErrnoException).code).toBe("ELOOP");
    });
  });

  describe("mv", () => {
    it("should move files", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.mv("/source.txt", "/dest.txt");

      expect(fs.existsSync(path.join(tempDir, "source.txt"))).toBe(false);
      expect(fs.readFileSync(path.join(tempDir, "dest.txt"), "utf8")).toBe(
        "content",
      );
    });

    it("should move directories", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

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
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.chmod("/file.txt", 0o755);

      const stat = fs.statSync(path.join(tempDir, "file.txt"));
      expect(stat.mode & 0o777).toBe(0o755);
    });

    it("should throw ENOENT for non-existent file", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.chmod("/nonexistent", 0o755)).rejects.toThrow("ENOENT");
    });

    it("should preserve special mode bits through replacement", async () => {
      const filePath = path.join(tempDir, "special-mode.txt");
      fs.writeFileSync(filePath, "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.chmod("/special-mode.txt", 0o4755);

      expect(fs.statSync(filePath).mode & 0o7777).toBe(0o4755);
    });

    it("should allow metadata operations above maxFileReadSize", async () => {
      const filePath = path.join(tempDir, "large-metadata.txt");
      fs.writeFileSync(filePath, "content larger than four bytes");
      const changed = new Date("2020-05-01T00:00:00.000Z");
      const rwfs = new ReadWriteFs({ root: tempDir, maxFileReadSize: 4 });

      await rwfs.chmod("/large-metadata.txt", 0o700);
      await rwfs.utimes("/large-metadata.txt", changed, changed);

      const stat = fs.statSync(filePath);
      expect(stat.mode & 0o777).toBe(0o700);
      expect(stat.mtimeMs).toBe(changed.getTime());
    });
  });

  describe("symlink", () => {
    it("should create symbolic links", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

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
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.symlink("target", "/existing")).rejects.toThrow(
        "EEXIST",
      );
    });

    it("should write through an allowed dangling symlink within the root", async () => {
      fs.symlinkSync("target.txt", path.join(tempDir, "link.txt"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/link.txt", "created");

      expect(fs.readlinkSync(path.join(tempDir, "link.txt"))).toBe(
        "target.txt",
      );
      expect(fs.readFileSync(path.join(tempDir, "target.txt"), "utf8")).toBe(
        "created",
      );
    });

    it("should write through an allowed absolute dangling symlink within the root", async () => {
      fs.symlinkSync(
        path.join(tempDir, "target.txt"),
        path.join(tempDir, "link"),
      );
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/link", "created");

      expect(fs.readFileSync(path.join(tempDir, "target.txt"), "utf8")).toBe(
        "created",
      );
    });

    it("rejects a dangling absolute symlink whose nested target leaves the root", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.mkdirSync(path.join(outsideDir, "dir"));
        fs.symlinkSync(path.join(outsideDir, "dir"), path.join(tempDir, "b"));
        fs.symlinkSync("b/../missing", path.join(tempDir, "a"));
        fs.symlinkSync(
          path.join(fs.realpathSync(tempDir), "a"),
          path.join(tempDir, "link"),
        );
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/link")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects a dangling absolute symlink spelled through a root alias when its nested target leaves", async () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-parent-"));
      try {
        const root = path.join(parent, "root");
        const alias = path.join(parent, "alias");
        const outside = path.join(parent, "outside");
        fs.mkdirSync(root);
        fs.mkdirSync(outside);
        fs.symlinkSync(root, alias);
        fs.symlinkSync(outside, path.join(root, "b"));
        fs.symlinkSync("b/../missing", path.join(root, "a"));
        fs.symlinkSync(path.join(alias, "a"), path.join(root, "link"));
        const rwfs = new ReadWriteFs({ root, allowSymlinks: true });

        await expect(rwfs.stat("/link")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    });

    it("rejects an escaping parent component when the sandbox root is its symlink", async () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-parent-"));
      try {
        const root = path.join(parent, "root");
        const alias = path.join(parent, "alias");
        fs.mkdirSync(root);
        fs.mkdirSync(path.join(parent, "outside"));
        fs.symlinkSync(root, alias);
        fs.symlinkSync("../outside", path.join(root, "b"));
        fs.symlinkSync("b/../missing", path.join(root, "a"));
        fs.symlinkSync(path.join(alias, "a"), path.join(root, "link"));
        const rwfs = new ReadWriteFs({ root: alias, allowSymlinks: true });

        await expect(rwfs.stat("/link")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    });

    it("rejects an escaping target normalized away by an outer dangling link", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.mkdirSync(path.join(outsideDir, "dir"));
        fs.symlinkSync(path.join(outsideDir, "dir"), path.join(tempDir, "b"));
        fs.symlinkSync("b/../missing", path.join(tempDir, "a"));
        fs.symlinkSync("a/../missing", path.join(tempDir, "outer"));
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(rwfs.stat("/outer")).rejects.toThrow("outside sandbox");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("does not expose a file outside the root through an absolute target that normalizes '..'", async () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-parent-"));
      try {
        const root = path.join(parent, "root");
        const outside = path.join(parent, "outside");
        fs.mkdirSync(root);
        fs.writeFileSync(outside, "secret");
        const absoluteTarget = `${fs.realpathSync(root)}/../outside`;
        fs.symlinkSync(absoluteTarget, path.join(root, "link"));
        const rwfs = new ReadWriteFs({ root, allowSymlinks: true });

        await expect(rwfs.stat("/link/child")).rejects.toThrow(
          "outside sandbox",
        );
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    });

    it("preserves an in-root errno through a link with an internal parent traversal", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.writeFileSync(path.join(tempDir, "file"), "content");
      fs.symlinkSync("dir/../file", path.join(tempDir, "link"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.stat("/link/child")).rejects.toThrow("ENOTDIR");
    });

    it("preserves an in-root errno through an absolute target in a subdirectory", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.writeFileSync(path.join(tempDir, "file"), "content");
      fs.symlinkSync(
        path.join(fs.realpathSync(tempDir), "file"),
        path.join(tempDir, "dir", "link"),
      );
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.stat("/dir/link/child")).rejects.toThrow("ENOTDIR");
    });

    it("fails closed on an absolute target spelled through a root alias", async () => {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-parent-"));
      try {
        const root = path.join(parent, "root");
        const alias = path.join(parent, "alias");
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, "file"), "content");
        fs.symlinkSync(root, alias);
        fs.symlinkSync(path.join(alias, "file"), path.join(root, "link"));
        const rwfs = new ReadWriteFs({ root, allowSymlinks: true });

        await expect(rwfs.stat("/link/child")).rejects.toThrow(
          "outside sandbox",
        );
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    });
  });

  describe("link", () => {
    it("should create hard links", async () => {
      fs.writeFileSync(path.join(tempDir, "original.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.link("/original.txt", "/hardlink.txt");

      const content = fs.readFileSync(
        path.join(tempDir, "hardlink.txt"),
        "utf8",
      );
      expect(content).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.link("/nonexistent", "/link")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should throw EEXIST for existing destination", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      fs.writeFileSync(path.join(tempDir, "existing.txt"), "existing");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

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
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const target = await rwfs.readlink("/link");
      expect(target).toBe("target.txt");
    });

    it("should throw ENOENT for non-existent symlink", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readlink("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw EINVAL for non-symlink", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.readlink("/file.txt")).rejects.toThrow("EINVAL");
    });
  });

  describe("resolvePath", () => {
    it("should resolve relative paths", () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      expect(rwfs.resolvePath("/dir", "file.txt")).toBe("/dir/file.txt");
      expect(rwfs.resolvePath("/dir", "../file.txt")).toBe("/file.txt");
    });

    it("should handle absolute paths", () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

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
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const paths = rwfs.getAllPaths();
      expect(paths).toContain("/a.txt");
      expect(paths).toContain("/subdir");
      expect(paths).toContain("/subdir/b.txt");
    });
  });

  describe("encoding support", () => {
    it("should write and read with base64 encoding", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      const base64Content = btoa("Hello World");

      await rwfs.writeFile("/base64.txt", base64Content, "base64");
      const content = await rwfs.readFile("/base64.txt");
      expect(content).toBe("Hello World");
    });

    it("should write and read with hex encoding", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      const hexContent = "48656c6c6f"; // "Hello"

      await rwfs.writeFile("/hex.txt", hexContent, "hex");
      const content = await rwfs.readFile("/hex.txt");
      expect(content).toBe("Hello");
    });
  });

  describe("readdirWithFileTypes", () => {
    it("should return entries with correct type info", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      fs.mkdirSync(path.join(tempDir, "subdir"));

      const entries = await rwfs.readdirWithFileTypes("/");

      const file = entries.find((e) => e.name === "file.txt");
      expect(file).toBeDefined();
      expect(file?.isFile).toBe(true);
      expect(file?.isDirectory).toBe(false);
      expect(file?.isSymbolicLink).toBe(false);

      const subdir = entries.find((e) => e.name === "subdir");
      expect(subdir).toBeDefined();
      expect(subdir?.isFile).toBe(false);
      expect(subdir?.isDirectory).toBe(true);
      expect(subdir?.isSymbolicLink).toBe(false);
    });

    it("should return entries sorted case-sensitively", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "Zebra.txt"), "z");
      fs.writeFileSync(path.join(tempDir, "apple.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "Banana.txt"), "b");

      const entries = await rwfs.readdirWithFileTypes("/");
      const names = entries.map((e) => e.name);

      // Case-sensitive sort: uppercase before lowercase
      expect(names).toEqual(["Banana.txt", "Zebra.txt", "apple.txt"]);
    });

    it("should identify symlinks correctly", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "real.txt"), "content");
      fs.symlinkSync(
        path.join(tempDir, "real.txt"),
        path.join(tempDir, "link.txt"),
      );

      const entries = await rwfs.readdirWithFileTypes("/");

      const link = entries.find((e) => e.name === "link.txt");
      expect(link).toBeDefined();
      expect(link?.isFile).toBe(false);
      expect(link?.isDirectory).toBe(false);
      expect(link?.isSymbolicLink).toBe(true);
    });

    it("should throw ENOENT for non-existent directory", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.readdirWithFileTypes("/nonexistent")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should throw ENOTDIR for file path", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");

      await expect(rwfs.readdirWithFileTypes("/file.txt")).rejects.toThrow(
        "ENOTDIR",
      );
    });

    it("should return same names as readdir", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "sub"));

      const namesFromReaddir = await rwfs.readdir("/");
      const entriesWithTypes = await rwfs.readdirWithFileTypes("/");
      const namesFromWithTypes = entriesWithTypes.map((e) => e.name);

      expect(namesFromWithTypes).toEqual(namesFromReaddir);
    });
  });
});
