import { describe, expect, it, vi } from "vitest";
import type { LazyDirEntry, LazyFileContent } from "./lazy-fs.js";
import { LazyFs } from "./lazy-fs.js";

describe("LazyFs", () => {
  describe("file loading", () => {
    it("should call loadFile on first file access", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "hello world",
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const content = await fs.readFile("/test.txt");

      expect(content).toBe("hello world");
      expect(loadFile).toHaveBeenCalledWith("/test.txt");
      expect(loadFile).toHaveBeenCalledTimes(1);
    });

    it("should cache file content after first load", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "cached content",
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.readFile("/test.txt");
      await fs.readFile("/test.txt");
      await fs.readFile("/test.txt");

      expect(loadFile).toHaveBeenCalledTimes(1);
    });

    it("should return ENOENT when loadFile returns null", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");
    });

    it("should cache negative results (file not found)", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");
      await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");

      expect(loadFile).toHaveBeenCalledTimes(1);
    });

    it("should handle binary content", async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
      const loadFile = vi.fn().mockResolvedValue({
        content: binaryData,
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const result = await fs.readFileBuffer("/binary.bin");

      expect(result).toEqual(binaryData);
    });

    it("should respect mode from loadFile result", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "executable",
        mode: 0o755,
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const stat = await fs.stat("/script.sh");

      expect(stat.mode).toBe(0o755);
    });

    it("should respect mtime from loadFile result", async () => {
      const mtime = new Date("2024-01-15T10:30:00Z");
      const loadFile = vi.fn().mockResolvedValue({
        content: "content",
        mtime,
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const stat = await fs.stat("/file.txt");

      expect(stat.mtime.getTime()).toBe(mtime.getTime());
    });
  });

  describe("directory loading", () => {
    it("should call listDir on readdir", async () => {
      const listDir = vi.fn().mockResolvedValue([
        { name: "file1.txt", type: "file" },
        { name: "file2.txt", type: "file" },
        { name: "subdir", type: "directory" },
      ] satisfies LazyDirEntry[]);
      const loadFile = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const entries = await fs.readdir("/");

      expect(entries).toEqual(["file1.txt", "file2.txt", "subdir"]);
      expect(listDir).toHaveBeenCalledWith("/");
    });

    it("should call listDir for each readdir (gets fresh entries)", async () => {
      const listDir = vi
        .fn()
        .mockResolvedValue([
          { name: "file.txt", type: "file" },
        ] satisfies LazyDirEntry[]);
      const loadFile = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.readdir("/");
      await fs.readdir("/");
      await fs.readdir("/");

      // listDir is called once to verify existence, then once to get entries per readdir
      // After first call, dir is marked as loaded so subsequent calls only get entries
      expect(listDir).toHaveBeenCalledTimes(4); // 1 for ensureDirLoaded + 3 for getDirEntries
    });

    it("should return ENOENT for non-existent directory", async () => {
      const listDir = vi.fn().mockResolvedValue(null);
      const loadFile = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      await expect(fs.readdir("/missing")).rejects.toThrow("ENOENT");
    });

    it("should return entries with correct types via readdirWithFileTypes", async () => {
      const listDir = vi.fn().mockResolvedValue([
        { name: "file.txt", type: "file" },
        { name: "dir", type: "directory" },
        { name: "link", type: "symlink" },
      ] satisfies LazyDirEntry[]);
      const loadFile = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const entries = await fs.readdirWithFileTypes("/");

      expect(entries).toHaveLength(3);

      const file = entries.find((e) => e.name === "file.txt");
      expect(file?.isFile).toBe(true);
      expect(file?.isDirectory).toBe(false);
      expect(file?.isSymbolicLink).toBe(false);

      const dir = entries.find((e) => e.name === "dir");
      expect(dir?.isFile).toBe(false);
      expect(dir?.isDirectory).toBe(true);
      expect(dir?.isSymbolicLink).toBe(false);

      const link = entries.find((e) => e.name === "link");
      expect(link?.isFile).toBe(false);
      expect(link?.isDirectory).toBe(false);
      expect(link?.isSymbolicLink).toBe(true);
    });

    it("should sort entries", async () => {
      const listDir = vi.fn().mockResolvedValue([
        { name: "zebra.txt", type: "file" },
        { name: "apple.txt", type: "file" },
        { name: "Banana.txt", type: "file" },
      ] satisfies LazyDirEntry[]);
      const loadFile = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const entries = await fs.readdir("/");

      // Case-sensitive sort
      expect(entries).toEqual(["Banana.txt", "apple.txt", "zebra.txt"]);
    });
  });

  describe("write operations", () => {
    it("should write files without calling loader", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.writeFile("/new.txt", "new content");
      const content = await fs.readFile("/new.txt");

      expect(content).toBe("new content");
      expect(loadFile).not.toHaveBeenCalledWith("/new.txt");
    });

    it("should shadow lazy content after write", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "original",
      });
      const listDir = vi
        .fn()
        .mockResolvedValue([{ name: "file.txt", type: "file" }]);

      const fs = new LazyFs({ loadFile, listDir });

      // First read loads from loader
      const original = await fs.readFile("/file.txt");
      expect(original).toBe("original");

      // Write shadows the lazy content
      await fs.writeFile("/file.txt", "modified");

      // Subsequent reads return modified content
      const modified = await fs.readFile("/file.txt");
      expect(modified).toBe("modified");

      // Loader should only be called once (before write)
      expect(loadFile).toHaveBeenCalledTimes(1);
    });

    it("should append to lazy-loaded files", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "hello",
      });
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.appendFile("/file.txt", " world");
      const content = await fs.readFile("/file.txt");

      expect(content).toBe("hello world");
    });

    it("should throw EROFS when writes disabled", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir, allowWrites: false });

      await expect(fs.writeFile("/file.txt", "content")).rejects.toThrow(
        "EROFS",
      );
    });
  });

  describe("delete operations", () => {
    it("should shadow lazy content after delete", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "content",
      });
      const listDir = vi
        .fn()
        .mockResolvedValue([{ name: "file.txt", type: "file" }]);

      const fs = new LazyFs({ loadFile, listDir });

      // Verify file exists initially
      expect(await fs.exists("/file.txt")).toBe(true);

      // Delete
      await fs.rm("/file.txt");

      // File should no longer exist
      expect(await fs.exists("/file.txt")).toBe(false);
      await expect(fs.readFile("/file.txt")).rejects.toThrow("ENOENT");
    });

    it("should not show deleted files in readdir", async () => {
      const listDir = vi.fn().mockResolvedValue([
        { name: "file1.txt", type: "file" },
        { name: "file2.txt", type: "file" },
      ]);
      const loadFile = vi.fn().mockResolvedValue({ content: "x" });

      const fs = new LazyFs({ loadFile, listDir });

      await fs.rm("/file1.txt");

      const entries = await fs.readdir("/");
      expect(entries).toEqual(["file2.txt"]);
    });

    it("should allow recreating deleted files", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "original",
      });
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      // Load, delete, then recreate
      await fs.readFile("/file.txt");
      await fs.rm("/file.txt");
      await fs.writeFile("/file.txt", "new content");

      const content = await fs.readFile("/file.txt");
      expect(content).toBe("new content");
    });
  });

  describe("stat operations", () => {
    it("should identify files vs directories from listDir", async () => {
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/") {
          return [
            { name: "file.txt", type: "file" },
            { name: "dir", type: "directory" },
          ] satisfies LazyDirEntry[];
        }
        if (path === "/dir") {
          return [];
        }
        return null;
      });
      const loadFile = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/file.txt") {
          return { content: "content" };
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      const fileStat = await fs.stat("/file.txt");
      expect(fileStat.isFile).toBe(true);
      expect(fileStat.isDirectory).toBe(false);

      const dirStat = await fs.stat("/dir");
      expect(dirStat.isFile).toBe(false);
      expect(dirStat.isDirectory).toBe(true);
    });

    it("should return correct size for loaded files", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "hello", // 5 bytes
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const stat = await fs.stat("/file.txt");

      expect(stat.size).toBe(5);
    });
  });

  describe("symlink handling", () => {
    it("should load symlinks correctly", async () => {
      const loadFile = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/link") {
          return {
            content: "/target.txt",
            isSymlink: true,
          } satisfies LazyFileContent;
        }
        if (path === "/target.txt") {
          return { content: "target content" };
        }
        return null;
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      // Reading the symlink should follow to target
      const content = await fs.readFile("/link");
      expect(content).toBe("target content");
    });

    it("should identify symlinks with lstat", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "/target",
        isSymlink: true,
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const stat = await fs.lstat("/link");

      expect(stat.isSymbolicLink).toBe(true);
      expect(stat.isFile).toBe(false);
    });

    it("should create symlinks locally", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        // Only root exists as a directory
        if (path === "/") {
          return [];
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      await fs.writeFile("/target.txt", "content");
      await fs.symlink("/target.txt", "/link");

      const target = await fs.readlink("/link");
      expect(target).toBe("/target.txt");

      const content = await fs.readFile("/link");
      expect(content).toBe("content");
    });
  });

  describe("mkdir", () => {
    it("should create directories locally", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        // Only root exists as a directory
        if (path === "/") {
          return [];
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      await fs.mkdir("/newdir");

      const stat = await fs.stat("/newdir");
      expect(stat.isDirectory).toBe(true);
    });

    it("should create nested directories with recursive option", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        // Only root exists as a directory
        if (path === "/") {
          return [];
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      await fs.mkdir("/a/b/c", { recursive: true });

      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
      expect(await fs.exists("/a/b/c")).toBe(true);
    });

    it("should throw EEXIST for existing directory without recursive", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        // Only root exists as a directory initially
        if (path === "/") {
          return [];
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      await fs.mkdir("/dir");

      await expect(fs.mkdir("/dir")).rejects.toThrow("EEXIST");
    });
  });

  describe("exists", () => {
    it("should return true for loaded files", async () => {
      const loadFile = vi.fn().mockResolvedValue({ content: "x" });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      expect(await fs.exists("/file.txt")).toBe(true);
    });

    it("should return true for loaded directories", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      expect(await fs.exists("/dir")).toBe(true);
    });

    it("should return false for non-existent paths", async () => {
      const loadFile = vi.fn().mockResolvedValue(null);
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      expect(await fs.exists("/missing")).toBe(false);
    });

    it("should return false for deleted paths", async () => {
      const loadFile = vi.fn().mockResolvedValue({ content: "x" });
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.rm("/file.txt");

      expect(await fs.exists("/file.txt")).toBe(false);
    });
  });

  describe("cp and mv", () => {
    it("should copy lazy-loaded files", async () => {
      const loadFile = vi.fn().mockResolvedValue({ content: "copied" });
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.cp("/src.txt", "/dst.txt");

      const content = await fs.readFile("/dst.txt");
      expect(content).toBe("copied");
    });

    it("should move lazy-loaded files", async () => {
      const loadFile = vi.fn().mockResolvedValue({ content: "moved" });
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.mv("/src.txt", "/dst.txt");

      expect(await fs.exists("/src.txt")).toBe(false);
      const content = await fs.readFile("/dst.txt");
      expect(content).toBe("moved");
    });
  });

  describe("chmod and utimes", () => {
    it("should change mode of lazy-loaded file", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "x",
        mode: 0o644,
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.chmod("/file.txt", 0o755);

      const stat = await fs.stat("/file.txt");
      expect(stat.mode).toBe(0o755);
    });

    it("should change mtime of lazy-loaded file", async () => {
      const loadFile = vi.fn().mockResolvedValue({ content: "x" });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const newTime = new Date("2025-01-01T00:00:00Z");
      await fs.utimes("/file.txt", newTime, newTime);

      const stat = await fs.stat("/file.txt");
      expect(stat.mtime.getTime()).toBe(newTime.getTime());
    });
  });

  describe("link and readlink", () => {
    it("should create hard links", async () => {
      const loadFile = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/src.txt") {
          return { content: "content" };
        }
        return null;
      });
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        // Only root exists as a directory
        if (path === "/") {
          return [];
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      await fs.link("/src.txt", "/hardlink.txt");

      const content = await fs.readFile("/hardlink.txt");
      expect(content).toBe("content");
    });

    it("should read symlink targets", async () => {
      const loadFile = vi.fn().mockResolvedValue({
        content: "/target",
        isSymlink: true,
      });
      const listDir = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      const target = await fs.readlink("/link");
      expect(target).toBe("/target");
    });
  });

  describe("realpath", () => {
    it("should resolve symlinks in path", async () => {
      const loadFile = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/link") {
          return { content: "/real", isSymlink: true };
        }
        return null;
      });
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/real") {
          return [];
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      const resolved = await fs.realpath("/link");
      expect(resolved).toBe("/real");
    });
  });

  describe("resolvePath", () => {
    it("should resolve relative paths", () => {
      const fs = new LazyFs({
        loadFile: async () => null,
        listDir: async () => null,
      });

      expect(fs.resolvePath("/home", "file.txt")).toBe("/home/file.txt");
      expect(fs.resolvePath("/home/user", "../file.txt")).toBe(
        "/home/file.txt",
      );
      expect(fs.resolvePath("/", "file.txt")).toBe("/file.txt");
    });

    it("should handle absolute paths", () => {
      const fs = new LazyFs({
        loadFile: async () => null,
        listDir: async () => null,
      });

      expect(fs.resolvePath("/home", "/etc/passwd")).toBe("/etc/passwd");
    });
  });

  describe("getAllPaths", () => {
    it("should return loaded and modified paths", async () => {
      const loadFile = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/loaded.txt") {
          return { content: "x" };
        }
        return null;
      });
      const listDir = vi.fn().mockImplementation(async (path: string) => {
        if (path === "/") {
          return [];
        }
        return null;
      });

      const fs = new LazyFs({ loadFile, listDir });

      await fs.readFile("/loaded.txt");
      await fs.writeFile("/written.txt", "y");
      await fs.mkdir("/dir");

      const paths = fs.getAllPaths();

      expect(paths).toContain("/loaded.txt");
      expect(paths).toContain("/written.txt");
      expect(paths).toContain("/dir");
    });

    it("should not include deleted paths", async () => {
      const loadFile = vi.fn().mockResolvedValue({ content: "x" });
      const listDir = vi.fn().mockResolvedValue([]);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.readFile("/file.txt");
      await fs.rm("/file.txt");

      const paths = fs.getAllPaths();

      expect(paths).not.toContain("/file.txt");
    });
  });

  describe("locally added files in readdir", () => {
    it("should include locally written files in directory listing", async () => {
      const listDir = vi
        .fn()
        .mockResolvedValue([{ name: "remote.txt", type: "file" }]);
      const loadFile = vi.fn().mockResolvedValue(null);

      const fs = new LazyFs({ loadFile, listDir });

      await fs.writeFile("/local.txt", "local content");

      const entries = await fs.readdir("/");

      expect(entries).toContain("remote.txt");
      expect(entries).toContain("local.txt");
    });
  });
});
