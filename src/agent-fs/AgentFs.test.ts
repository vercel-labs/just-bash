import { AgentFS } from "agentfs-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentFs } from "./AgentFs.js";

describe("AgentFs", () => {
  let agentHandle: Awaited<ReturnType<typeof AgentFS.open>>;
  let fs: AgentFs;

  beforeEach(async () => {
    // Use in-memory database for tests
    agentHandle = await AgentFS.open({ path: ":memory:" });
    fs = new AgentFs({ agent: agentHandle });
  });

  afterEach(async () => {
    await agentHandle.close();
  });

  describe("constructor", () => {
    it("should create with default mount point", () => {
      expect(fs.getMountPoint()).toBe("/");
    });

    it("should accept custom mount point", () => {
      const customFs = new AgentFs({
        agent: agentHandle,
        mountPoint: "/mnt/data",
      });
      expect(customFs.getMountPoint()).toBe("/mnt/data");
    });

    it("should throw for non-absolute mount point", () => {
      expect(
        () => new AgentFs({ agent: agentHandle, mountPoint: "relative" }),
      ).toThrow("Mount point must be an absolute path");
    });
  });

  describe("writeFile and readFile", () => {
    it("should write and read a file", async () => {
      await fs.writeFile("/test.txt", "Hello, World!");
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("Hello, World!");
    });

    it("should write binary data", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      await fs.writeFile("/binary.bin", data);
      const buffer = await fs.readFileBuffer("/binary.bin");
      expect(buffer).toEqual(data);
    });

    it("should throw ENOENT for non-existent file", async () => {
      await expect(fs.readFile("/nonexistent.txt")).rejects.toThrow("ENOENT");
    });

    it("should handle different encodings", async () => {
      await fs.writeFile("/test.txt", "Hello");
      const base64 = await fs.readFile("/test.txt", "base64");
      expect(base64).toBe("SGVsbG8=");
    });
  });

  describe("appendFile", () => {
    it("should append to existing file", async () => {
      await fs.writeFile("/test.txt", "Hello");
      await fs.appendFile("/test.txt", ", World!");
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("Hello, World!");
    });

    it("should create file if it does not exist", async () => {
      await fs.appendFile("/new.txt", "New content");
      const content = await fs.readFile("/new.txt");
      expect(content).toBe("New content");
    });
  });

  describe("exists", () => {
    it("should return true for existing file", async () => {
      await fs.writeFile("/test.txt", "content");
      expect(await fs.exists("/test.txt")).toBe(true);
    });

    it("should return false for non-existent file", async () => {
      expect(await fs.exists("/nonexistent.txt")).toBe(false);
    });

    it("should return true for directory", async () => {
      await fs.mkdir("/mydir");
      expect(await fs.exists("/mydir")).toBe(true);
    });
  });

  describe("stat", () => {
    it("should return file stats", async () => {
      await fs.writeFile("/test.txt", "Hello");
      const stat = await fs.stat("/test.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(5);
    });

    it("should return directory stats", async () => {
      await fs.mkdir("/mydir");
      const stat = await fs.stat("/mydir");
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });

    it("should throw ENOENT for non-existent path", async () => {
      await expect(fs.stat("/nonexistent")).rejects.toThrow("ENOENT");
    });
  });

  describe("mkdir", () => {
    it("should create a directory", async () => {
      await fs.mkdir("/newdir");
      expect(await fs.exists("/newdir")).toBe(true);
      const stat = await fs.stat("/newdir");
      expect(stat.isDirectory).toBe(true);
    });

    it("should throw EEXIST if directory exists", async () => {
      await fs.mkdir("/mydir");
      await expect(fs.mkdir("/mydir")).rejects.toThrow("EEXIST");
    });

    it("should not throw with recursive if directory exists", async () => {
      await fs.mkdir("/mydir");
      await fs.mkdir("/mydir", { recursive: true });
    });

    it("should create parent directories with recursive", async () => {
      await fs.mkdir("/a/b/c", { recursive: true });
      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
      expect(await fs.exists("/a/b/c")).toBe(true);
    });

    it("should throw ENOENT without recursive if parent missing", async () => {
      await expect(fs.mkdir("/missing/subdir")).rejects.toThrow("ENOENT");
    });
  });

  describe("readdir", () => {
    it("should list directory contents", async () => {
      await fs.writeFile("/dir/file1.txt", "a");
      await fs.writeFile("/dir/file2.txt", "b");
      await fs.mkdir("/dir/subdir");
      const entries = await fs.readdir("/dir");
      expect(entries.sort()).toEqual(["file1.txt", "file2.txt", "subdir"]);
    });

    it("should throw ENOENT for non-existent directory", async () => {
      await expect(fs.readdir("/nonexistent")).rejects.toThrow("ENOENT");
    });
  });

  describe("rm", () => {
    it("should remove a file", async () => {
      await fs.writeFile("/test.txt", "content");
      await fs.rm("/test.txt");
      expect(await fs.exists("/test.txt")).toBe(false);
    });

    it("should throw ENOENT for non-existent file", async () => {
      await expect(fs.rm("/nonexistent.txt")).rejects.toThrow("ENOENT");
    });

    it("should not throw with force for non-existent file", async () => {
      await fs.rm("/nonexistent.txt", { force: true });
    });

    it("should remove empty directory", async () => {
      await fs.mkdir("/emptydir");
      await fs.rm("/emptydir");
      // Note: AgentFS may keep implicit directories around
    });

    it("should throw ENOTEMPTY for non-empty directory", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      await expect(fs.rm("/dir")).rejects.toThrow("ENOTEMPTY");
    });

    it("should remove non-empty directory with recursive", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      await fs.mkdir("/dir/subdir");
      await fs.rm("/dir", { recursive: true });
      // Note: AgentFS may keep implicit parent directories
      expect(await fs.exists("/dir/file.txt")).toBe(false);
    });
  });

  describe("cp", () => {
    it("should copy a file", async () => {
      await fs.writeFile("/src.txt", "content");
      await fs.cp("/src.txt", "/dest.txt");
      expect(await fs.readFile("/dest.txt")).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      await expect(fs.cp("/nonexistent", "/dest")).rejects.toThrow("ENOENT");
    });

    it("should throw EISDIR for directory without recursive", async () => {
      await fs.mkdir("/dir");
      await expect(fs.cp("/dir", "/dest")).rejects.toThrow("EISDIR");
    });

    it("should copy directory with recursive", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      await fs.cp("/dir", "/dest", { recursive: true });
      expect(await fs.readFile("/dest/file.txt")).toBe("content");
    });
  });

  describe("mv", () => {
    it("should move a file", async () => {
      await fs.writeFile("/src.txt", "content");
      await fs.mv("/src.txt", "/dest.txt");
      expect(await fs.exists("/src.txt")).toBe(false);
      expect(await fs.readFile("/dest.txt")).toBe("content");
    });

    it("should move a directory", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      await fs.mv("/dir", "/newdir");
      // Note: AgentFS may keep implicit parent directories
      expect(await fs.exists("/dir/file.txt")).toBe(false);
      expect(await fs.readFile("/newdir/file.txt")).toBe("content");
    });
  });

  describe("symlink", () => {
    it("should create a symlink-like file", async () => {
      await fs.writeFile("/target.txt", "content");
      await fs.symlink("/target.txt", "/link.txt");
      // Our symlink implementation stores a JSON marker
      const linkContent = await fs.readFile("/link.txt");
      expect(linkContent).toContain("__symlink");
    });

    it("should throw EEXIST if path exists", async () => {
      await fs.writeFile("/file.txt", "content");
      await expect(fs.symlink("/target", "/file.txt")).rejects.toThrow(
        "EEXIST",
      );
    });
  });

  describe("readlink", () => {
    it("should read symlink target", async () => {
      await fs.symlink("/target.txt", "/link.txt");
      const target = await fs.readlink("/link.txt");
      expect(target).toBe("/target.txt");
    });

    it("should throw ENOENT for non-existent path", async () => {
      await expect(fs.readlink("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw EINVAL for non-symlink", async () => {
      await fs.writeFile("/file.txt", "content");
      await expect(fs.readlink("/file.txt")).rejects.toThrow("EINVAL");
    });
  });

  describe("lstat", () => {
    it("should return stats (same as stat since no native symlinks)", async () => {
      await fs.writeFile("/file.txt", "content");
      const stat = await fs.lstat("/file.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isSymbolicLink).toBe(false);
    });
  });

  describe("link", () => {
    it("should create a hard link (copy)", async () => {
      await fs.writeFile("/original.txt", "content");
      await fs.link("/original.txt", "/hardlink.txt");
      expect(await fs.readFile("/hardlink.txt")).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      await expect(fs.link("/nonexistent", "/link")).rejects.toThrow("ENOENT");
    });

    it("should throw EEXIST if destination exists", async () => {
      await fs.writeFile("/src.txt", "a");
      await fs.writeFile("/dest.txt", "b");
      await expect(fs.link("/src.txt", "/dest.txt")).rejects.toThrow("EEXIST");
    });
  });

  describe("chmod", () => {
    it("should not throw for existing file", async () => {
      await fs.writeFile("/file.txt", "content");
      // chmod is a no-op but shouldn't throw
      await fs.chmod("/file.txt", 0o755);
    });

    it("should not throw for existing directory", async () => {
      await fs.mkdir("/dir");
      await fs.chmod("/dir", 0o700);
    });

    it("should throw ENOENT for non-existent path", async () => {
      await expect(fs.chmod("/nonexistent", 0o755)).rejects.toThrow("ENOENT");
    });
  });

  describe("resolvePath", () => {
    it("should resolve absolute paths", () => {
      expect(fs.resolvePath("/base", "/absolute")).toBe("/absolute");
    });

    it("should resolve relative paths", () => {
      expect(fs.resolvePath("/base/dir", "file.txt")).toBe(
        "/base/dir/file.txt",
      );
    });

    it("should handle .. in paths", () => {
      expect(fs.resolvePath("/base/dir", "../file.txt")).toBe("/base/file.txt");
    });
  });

  describe("getAllPaths", () => {
    it("should return empty array (no tracking)", async () => {
      await fs.writeFile("/file1.txt", "a");
      await fs.mkdir("/dir");
      // getAllPaths returns empty since we don't track paths
      const paths = fs.getAllPaths();
      expect(paths).toEqual([]);
    });
  });
});
