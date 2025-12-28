import { AgentFS } from "agentfs-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentFs } from "./AgentFs.js";

describe("AgentFs", () => {
  let agentHandle: Awaited<ReturnType<typeof AgentFS.open>>;
  let fs: AgentFs;

  beforeEach(async () => {
    // Use in-memory database for tests
    agentHandle = await AgentFS.open({ path: ":memory:" });
    fs = new AgentFs({ fs: agentHandle });
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
        fs: agentHandle,
        mountPoint: "/mnt/data",
      });
      expect(customFs.getMountPoint()).toBe("/mnt/data");
    });

    it("should normalize mount point with trailing slash", () => {
      const customFs = new AgentFs({
        fs: agentHandle,
        mountPoint: "/mnt/data/",
      });
      expect(customFs.getMountPoint()).toBe("/mnt/data");
    });

    it("should throw for non-absolute mount point", () => {
      expect(
        () => new AgentFs({ fs: agentHandle, mountPoint: "relative" }),
      ).toThrow("Mount point must be an absolute path");
    });
  });

  describe("readFile", () => {
    it("should read file as utf8 by default", async () => {
      await fs.writeFile("/test.txt", "Hello, World!");
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("Hello, World!");
    });

    it("should read file with explicit utf8 encoding", async () => {
      await fs.writeFile("/test.txt", "Hello");
      const content = await fs.readFile("/test.txt", "utf8");
      expect(content).toBe("Hello");
    });

    it("should read file with utf-8 encoding", async () => {
      await fs.writeFile("/test.txt", "Hello");
      const content = await fs.readFile("/test.txt", "utf-8");
      expect(content).toBe("Hello");
    });

    it("should read file as base64", async () => {
      await fs.writeFile("/test.txt", "Hello");
      const content = await fs.readFile("/test.txt", "base64");
      expect(content).toBe("SGVsbG8=");
    });

    it("should read file as hex", async () => {
      await fs.writeFile("/test.txt", "Hi");
      const content = await fs.readFile("/test.txt", "hex");
      expect(content).toBe("4869");
    });

    it("should read file as binary/latin1", async () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      await fs.writeFile("/test.bin", data);
      const content = await fs.readFile("/test.bin", "binary");
      expect(content).toBe("Hello");
    });

    it("should read file with options object", async () => {
      await fs.writeFile("/test.txt", "Test");
      const content = await fs.readFile("/test.txt", { encoding: "base64" });
      expect(content).toBe("VGVzdA==");
    });

    it("should throw ENOENT for non-existent file", async () => {
      await expect(fs.readFile("/nonexistent.txt")).rejects.toThrow("ENOENT");
    });
  });

  describe("readFileBuffer", () => {
    it("should read file as Uint8Array", async () => {
      await fs.writeFile("/test.txt", "Hello");
      const buffer = await fs.readFileBuffer("/test.txt");
      expect(buffer).toBeInstanceOf(Uint8Array);
      expect(buffer).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    });

    it("should read binary data correctly", async () => {
      const data = new Uint8Array([0, 1, 2, 255, 254, 253]);
      await fs.writeFile("/binary.bin", data);
      const buffer = await fs.readFileBuffer("/binary.bin");
      expect(buffer).toEqual(data);
    });

    it("should throw ENOENT for non-existent file", async () => {
      await expect(fs.readFileBuffer("/nonexistent.bin")).rejects.toThrow(
        "ENOENT",
      );
    });
  });

  describe("writeFile", () => {
    it("should write string content", async () => {
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

    it("should write with base64 encoding", async () => {
      await fs.writeFile("/test.txt", "SGVsbG8=", "base64");
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("Hello");
    });

    it("should write with hex encoding", async () => {
      await fs.writeFile("/test.txt", "48656c6c6f", "hex");
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("Hello");
    });

    it("should write with binary/latin1 encoding", async () => {
      await fs.writeFile("/test.txt", "Hello", "latin1");
      const buffer = await fs.readFileBuffer("/test.txt");
      expect(buffer).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    });

    it("should write with options object", async () => {
      await fs.writeFile("/test.txt", "SGk=", { encoding: "base64" });
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("Hi");
    });

    it("should overwrite existing file", async () => {
      await fs.writeFile("/test.txt", "First");
      await fs.writeFile("/test.txt", "Second");
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("Second");
    });

    it("should create parent directories implicitly", async () => {
      await fs.writeFile("/a/b/c/file.txt", "nested");
      const content = await fs.readFile("/a/b/c/file.txt");
      expect(content).toBe("nested");
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

    it("should append binary data", async () => {
      await fs.writeFile("/test.bin", new Uint8Array([1, 2, 3]));
      await fs.appendFile("/test.bin", new Uint8Array([4, 5]));
      const buffer = await fs.readFileBuffer("/test.bin");
      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it("should append with encoding", async () => {
      await fs.writeFile("/test.txt", "Hello");
      await fs.appendFile("/test.txt", "V29ybGQ=", "base64"); // "World"
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("HelloWorld");
    });

    it("should append multiple times", async () => {
      await fs.appendFile("/test.txt", "A");
      await fs.appendFile("/test.txt", "B");
      await fs.appendFile("/test.txt", "C");
      const content = await fs.readFile("/test.txt");
      expect(content).toBe("ABC");
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

    it("should return true for nested path", async () => {
      await fs.writeFile("/a/b/c.txt", "content");
      expect(await fs.exists("/a/b/c.txt")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
      expect(await fs.exists("/a")).toBe(true);
    });

    it("should return false for partial path", async () => {
      await fs.writeFile("/abc.txt", "content");
      expect(await fs.exists("/ab")).toBe(false);
    });
  });

  describe("stat", () => {
    it("should return file stats", async () => {
      await fs.writeFile("/test.txt", "Hello");
      const stat = await fs.stat("/test.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.isSymbolicLink).toBe(false);
      expect(stat.size).toBe(5);
    });

    it("should return directory stats", async () => {
      await fs.mkdir("/mydir");
      const stat = await fs.stat("/mydir");
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
      expect(stat.isSymbolicLink).toBe(false);
    });

    it("should return mode", async () => {
      await fs.writeFile("/test.txt", "content");
      const stat = await fs.stat("/test.txt");
      expect(typeof stat.mode).toBe("number");
    });

    it("should return mtime as Date", async () => {
      await fs.writeFile("/test.txt", "content");
      const stat = await fs.stat("/test.txt");
      expect(stat.mtime).toBeInstanceOf(Date);
    });

    it("should throw ENOENT for non-existent path", async () => {
      await expect(fs.stat("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should return correct size for binary data", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      await fs.writeFile("/binary.bin", data);
      const stat = await fs.stat("/binary.bin");
      expect(stat.size).toBe(10);
    });
  });

  describe("lstat", () => {
    it("should return file stats", async () => {
      await fs.writeFile("/file.txt", "content");
      const stat = await fs.lstat("/file.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isSymbolicLink).toBe(false);
    });

    it("should return directory stats", async () => {
      await fs.mkdir("/dir");
      const stat = await fs.lstat("/dir");
      expect(stat.isDirectory).toBe(true);
    });

    it("should throw ENOENT for non-existent path", async () => {
      await expect(fs.lstat("/nonexistent")).rejects.toThrow("ENOENT");
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

    it("should throw EEXIST if file exists at path", async () => {
      await fs.writeFile("/myfile", "content");
      await expect(fs.mkdir("/myfile")).rejects.toThrow("EEXIST");
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

    it("should create deeply nested directories", async () => {
      await fs.mkdir("/a/b/c/d/e/f", { recursive: true });
      expect(await fs.exists("/a/b/c/d/e/f")).toBe(true);
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

    it("should return empty array for empty directory", async () => {
      await fs.mkdir("/emptydir");
      const entries = await fs.readdir("/emptydir");
      expect(entries).toEqual([]);
    });

    it("should return sorted entries", async () => {
      await fs.writeFile("/dir/z.txt", "");
      await fs.writeFile("/dir/a.txt", "");
      await fs.writeFile("/dir/m.txt", "");
      const entries = await fs.readdir("/dir");
      expect(entries).toEqual(["a.txt", "m.txt", "z.txt"]);
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
      expect(await fs.exists("/emptydir")).toBe(false);
    });

    it("should throw ENOTEMPTY for non-empty directory", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      await expect(fs.rm("/dir")).rejects.toThrow("ENOTEMPTY");
    });

    it("should remove non-empty directory with recursive", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      await fs.mkdir("/dir/subdir");
      await fs.writeFile("/dir/subdir/nested.txt", "nested");
      await fs.rm("/dir", { recursive: true });
      expect(await fs.exists("/dir/file.txt")).toBe(false);
      expect(await fs.exists("/dir/subdir/nested.txt")).toBe(false);
    });

    it("should handle recursive + force together", async () => {
      await fs.rm("/nonexistent", { recursive: true, force: true });
    });
  });

  describe("cp", () => {
    it("should copy a file", async () => {
      await fs.writeFile("/src.txt", "content");
      await fs.cp("/src.txt", "/dest.txt");
      expect(await fs.readFile("/dest.txt")).toBe("content");
      // Source should still exist
      expect(await fs.exists("/src.txt")).toBe(true);
    });

    it("should copy binary file", async () => {
      const data = new Uint8Array([0, 1, 2, 255, 254]);
      await fs.writeFile("/src.bin", data);
      await fs.cp("/src.bin", "/dest.bin");
      const buffer = await fs.readFileBuffer("/dest.bin");
      expect(buffer).toEqual(data);
    });

    it("should overwrite destination", async () => {
      await fs.writeFile("/src.txt", "new content");
      await fs.writeFile("/dest.txt", "old content");
      await fs.cp("/src.txt", "/dest.txt");
      expect(await fs.readFile("/dest.txt")).toBe("new content");
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

    it("should copy nested directory structure", async () => {
      await fs.writeFile("/src/a/b/c.txt", "nested");
      await fs.writeFile("/src/a/d.txt", "sibling");
      await fs.cp("/src", "/dest", { recursive: true });
      expect(await fs.readFile("/dest/a/b/c.txt")).toBe("nested");
      expect(await fs.readFile("/dest/a/d.txt")).toBe("sibling");
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
      expect(await fs.exists("/dir/file.txt")).toBe(false);
      expect(await fs.readFile("/newdir/file.txt")).toBe("content");
    });

    it("should rename a file in same directory", async () => {
      await fs.writeFile("/old.txt", "content");
      await fs.mv("/old.txt", "/new.txt");
      expect(await fs.exists("/old.txt")).toBe(false);
      expect(await fs.readFile("/new.txt")).toBe("content");
    });

    it("should move file to different directory", async () => {
      await fs.writeFile("/a/file.txt", "content");
      await fs.mkdir("/b");
      await fs.mv("/a/file.txt", "/b/file.txt");
      expect(await fs.exists("/a/file.txt")).toBe(false);
      expect(await fs.readFile("/b/file.txt")).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      await expect(fs.mv("/nonexistent", "/dest")).rejects.toThrow("ENOENT");
    });
  });

  describe("symlink", () => {
    it("should create a symlink-like file", async () => {
      await fs.writeFile("/target.txt", "content");
      await fs.symlink("/target.txt", "/link.txt");
      // Our symlink implementation stores a JSON marker
      const linkContent = await fs.readFile("/link.txt");
      expect(linkContent).toContain("__symlink");
      expect(linkContent).toContain("/target.txt");
    });

    it("should support relative symlink targets", async () => {
      await fs.symlink("../other.txt", "/dir/link.txt");
      const target = await fs.readlink("/dir/link.txt");
      expect(target).toBe("../other.txt");
    });

    it("should throw EEXIST if path exists", async () => {
      await fs.writeFile("/file.txt", "content");
      await expect(fs.symlink("/target", "/file.txt")).rejects.toThrow(
        "EEXIST",
      );
    });

    it("should allow creating symlink to non-existent target", async () => {
      await fs.symlink("/nonexistent", "/link.txt");
      const target = await fs.readlink("/link.txt");
      expect(target).toBe("/nonexistent");
    });
  });

  describe("readlink", () => {
    it("should read symlink target", async () => {
      await fs.symlink("/target.txt", "/link.txt");
      const target = await fs.readlink("/link.txt");
      expect(target).toBe("/target.txt");
    });

    it("should read relative symlink target", async () => {
      await fs.symlink("../relative/path", "/dir/link.txt");
      const target = await fs.readlink("/dir/link.txt");
      expect(target).toBe("../relative/path");
    });

    it("should throw ENOENT for non-existent path", async () => {
      await expect(fs.readlink("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw EINVAL for non-symlink file", async () => {
      await fs.writeFile("/file.txt", "content");
      await expect(fs.readlink("/file.txt")).rejects.toThrow("EINVAL");
    });

    it("should throw EINVAL for directory", async () => {
      await fs.mkdir("/dir");
      await expect(fs.readlink("/dir")).rejects.toThrow("EINVAL");
    });
  });

  describe("link", () => {
    it("should create a hard link (copy)", async () => {
      await fs.writeFile("/original.txt", "content");
      await fs.link("/original.txt", "/hardlink.txt");
      expect(await fs.readFile("/hardlink.txt")).toBe("content");
    });

    it("should create independent copy", async () => {
      await fs.writeFile("/original.txt", "original");
      await fs.link("/original.txt", "/copy.txt");
      await fs.writeFile("/original.txt", "modified");
      // Since AgentFS uses copyFile, the "hard link" is actually a copy
      expect(await fs.readFile("/copy.txt")).toBe("original");
    });

    it("should throw ENOENT for non-existent source", async () => {
      await expect(fs.link("/nonexistent", "/link")).rejects.toThrow("ENOENT");
    });

    it("should throw EEXIST if destination exists", async () => {
      await fs.writeFile("/src.txt", "a");
      await fs.writeFile("/dest.txt", "b");
      await expect(fs.link("/src.txt", "/dest.txt")).rejects.toThrow("EEXIST");
    });

    it("should throw EPERM when source is directory", async () => {
      await fs.mkdir("/dir");
      await expect(fs.link("/dir", "/link")).rejects.toThrow("EPERM");
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

    it("should accept various mode values", async () => {
      await fs.writeFile("/file.txt", "content");
      await fs.chmod("/file.txt", 0o644);
      await fs.chmod("/file.txt", 0o777);
      await fs.chmod("/file.txt", 0o000);
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

    it("should handle . in paths", () => {
      expect(fs.resolvePath("/base/dir", "./file.txt")).toBe(
        "/base/dir/file.txt",
      );
    });

    it("should handle multiple .. in paths", () => {
      expect(fs.resolvePath("/a/b/c/d", "../../file.txt")).toBe(
        "/a/b/file.txt",
      );
    });

    it("should not go above root", () => {
      expect(fs.resolvePath("/base", "../../../file.txt")).toBe("/file.txt");
    });

    it("should handle root base", () => {
      expect(fs.resolvePath("/", "file.txt")).toBe("/file.txt");
    });

    it("should resolve empty relative path", () => {
      expect(fs.resolvePath("/base/dir", "")).toBe("/base/dir");
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

  describe("path normalization", () => {
    it("should handle trailing slashes", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      const content = await fs.readFile("/dir/file.txt/");
      expect(content).toBe("content");
    });

    it("should handle double slashes", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      const content = await fs.readFile("/dir//file.txt");
      expect(content).toBe("content");
    });

    it("should handle . in path", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      const content = await fs.readFile("/dir/./file.txt");
      expect(content).toBe("content");
    });

    it("should handle .. in path", async () => {
      await fs.writeFile("/dir/file.txt", "content");
      const content = await fs.readFile("/dir/subdir/../file.txt");
      expect(content).toBe("content");
    });
  });

  describe("mount point handling", () => {
    it("should work with custom mount point", async () => {
      const customFs = new AgentFs({
        fs: agentHandle,
        mountPoint: "/mnt/data",
      });
      await customFs.writeFile("/mnt/data/file.txt", "content");
      const content = await customFs.readFile("/mnt/data/file.txt");
      expect(content).toBe("content");
    });
  });
});
