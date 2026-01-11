import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { MountableFs } from "./mountable-fs.js";

describe("MountableFs", () => {
  describe("mount/unmount operations", () => {
    it("should mount a filesystem at a path", () => {
      const fs = new MountableFs();
      const mounted = new InMemoryFs();

      fs.mount("/mnt/data", mounted);

      expect(fs.isMountPoint("/mnt/data")).toBe(true);
      expect(fs.getMounts()).toHaveLength(1);
      expect(fs.getMounts()[0].mountPoint).toBe("/mnt/data");
    });

    it("should unmount a filesystem", () => {
      const fs = new MountableFs();
      const mounted = new InMemoryFs();

      fs.mount("/mnt/data", mounted);
      fs.unmount("/mnt/data");

      expect(fs.isMountPoint("/mnt/data")).toBe(false);
      expect(fs.getMounts()).toHaveLength(0);
    });

    it("should throw when unmounting non-existent mount", () => {
      const fs = new MountableFs();

      expect(() => fs.unmount("/mnt/data")).toThrow(
        "No filesystem mounted at '/mnt/data'",
      );
    });

    it("should allow remounting at same path", () => {
      const fs = new MountableFs();
      const mounted1 = new InMemoryFs({ "/file1.txt": "first" });
      const mounted2 = new InMemoryFs({ "/file2.txt": "second" });

      fs.mount("/mnt/data", mounted1);
      fs.mount("/mnt/data", mounted2);

      expect(fs.getMounts()).toHaveLength(1);
    });

    it("should support construction-time mounts", () => {
      const mounted = new InMemoryFs({ "/test.txt": "hello" });
      const fs = new MountableFs({
        mounts: [{ mountPoint: "/mnt/data", filesystem: mounted }],
      });

      expect(fs.isMountPoint("/mnt/data")).toBe(true);
    });

    it("should use provided baseFs", async () => {
      const base = new InMemoryFs({ "/base.txt": "base content" });
      const fs = new MountableFs({ base });

      const content = await fs.readFile("/base.txt");
      expect(content).toBe("base content");
    });
  });

  describe("mount validation", () => {
    it("should prevent mounting at root", () => {
      const fs = new MountableFs();
      const mounted = new InMemoryFs();

      expect(() => fs.mount("/", mounted)).toThrow("Cannot mount at root '/'");
    });

    it("should prevent nested mounts (new inside existing)", () => {
      const fs = new MountableFs();
      const mounted1 = new InMemoryFs();
      const mounted2 = new InMemoryFs();

      fs.mount("/mnt", mounted1);

      expect(() => fs.mount("/mnt/sub", mounted2)).toThrow(
        "Cannot mount at '/mnt/sub': inside existing mount '/mnt'",
      );
    });

    it("should prevent nested mounts (existing inside new)", () => {
      const fs = new MountableFs();
      const mounted1 = new InMemoryFs();
      const mounted2 = new InMemoryFs();

      fs.mount("/mnt/sub", mounted1);

      expect(() => fs.mount("/mnt", mounted2)).toThrow(
        "Cannot mount at '/mnt': would contain existing mount '/mnt/sub'",
      );
    });

    it("should allow sibling mounts", () => {
      const fs = new MountableFs();
      const mounted1 = new InMemoryFs();
      const mounted2 = new InMemoryFs();

      fs.mount("/mnt/a", mounted1);
      fs.mount("/mnt/b", mounted2);

      expect(fs.getMounts()).toHaveLength(2);
    });

    it("should reject mount points with . or .. segments", () => {
      const fs = new MountableFs();
      const mounted = new InMemoryFs();

      expect(() => fs.mount("/mnt/../data", mounted)).toThrow(
        "contains '.' or '..'",
      );
      expect(() => fs.mount("/mnt/./data", mounted)).toThrow(
        "contains '.' or '..'",
      );
      expect(() => fs.mount("/./mnt", mounted)).toThrow("contains '.' or '..'");
      expect(() => fs.mount("/../mnt", mounted)).toThrow(
        "contains '.' or '..'",
      );
    });
  });

  describe("path routing", () => {
    it("should route to mounted filesystem", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "mounted content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const content = await fs.readFile("/mnt/data/test.txt");
      expect(content).toBe("mounted content");
    });

    it("should route to base filesystem for unmounted paths", async () => {
      const base = new InMemoryFs({ "/base.txt": "base content" });
      const fs = new MountableFs({ base });

      const content = await fs.readFile("/base.txt");
      expect(content).toBe("base content");
    });

    it("should route writes to mounted filesystem", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.writeFile("/mnt/data/test.txt", "hello");

      // Verify written to mounted fs
      const content = await mounted.readFile("/test.txt");
      expect(content).toBe("hello");
    });

    it("should handle mount point root correctly", async () => {
      const mounted = new InMemoryFs({ "/file.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const exists = await fs.exists("/mnt/data");
      expect(exists).toBe(true);

      const stat = await fs.stat("/mnt/data");
      expect(stat.isDirectory).toBe(true);
    });
  });

  describe("directory operations", () => {
    it("should list mount points as directories", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const entries = await fs.readdir("/mnt");
      expect(entries).toContain("data");
    });

    it("should merge mount points with base fs entries", async () => {
      const base = new InMemoryFs();
      await base.mkdir("/mnt", { recursive: true });
      await base.writeFile("/mnt/base.txt", "base");

      const mounted = new InMemoryFs({ "/mounted.txt": "mounted" });
      const fs = new MountableFs({ base });
      fs.mount("/mnt/data", mounted);

      const entries = await fs.readdir("/mnt");
      expect(entries).toContain("base.txt");
      expect(entries).toContain("data");
    });

    it("should list entries from mounted filesystem", async () => {
      const mounted = new InMemoryFs({
        "/a.txt": "a",
        "/b.txt": "b",
      });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const entries = await fs.readdir("/mnt/data");
      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
    });

    it("should create directories in mounted filesystem", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.mkdir("/mnt/data/subdir");

      const exists = await mounted.exists("/subdir");
      expect(exists).toBe(true);
    });

    it("should handle mkdir at mount point with recursive", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      // Should not throw with recursive
      await fs.mkdir("/mnt/data", { recursive: true });
    });

    it("should throw when mkdir at mount point without recursive", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await expect(fs.mkdir("/mnt/data")).rejects.toThrow("EEXIST");
    });
  });

  describe("rm operations", () => {
    it("should remove files from mounted filesystem", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.rm("/mnt/data/test.txt");

      const exists = await mounted.exists("/test.txt");
      expect(exists).toBe(false);
    });

    it("should throw when removing mount point", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await expect(fs.rm("/mnt/data")).rejects.toThrow("EBUSY: mount point");
    });

    it("should throw when removing directory containing mount points", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await expect(fs.rm("/mnt", { recursive: true })).rejects.toThrow(
        "EBUSY: contains mount points",
      );
    });
  });

  describe("cross-mount copy", () => {
    it("should copy file from mounted to base", async () => {
      const mounted = new InMemoryFs({ "/src.txt": "content" });
      const base = new InMemoryFs();
      const fs = new MountableFs({ base });
      fs.mount("/mnt/data", mounted);

      await fs.cp("/mnt/data/src.txt", "/dest.txt");

      const content = await base.readFile("/dest.txt");
      expect(content).toBe("content");
    });

    it("should copy file from base to mounted", async () => {
      const mounted = new InMemoryFs();
      const base = new InMemoryFs({ "/src.txt": "content" });
      const fs = new MountableFs({ base });
      fs.mount("/mnt/data", mounted);

      await fs.cp("/src.txt", "/mnt/data/dest.txt");

      const content = await mounted.readFile("/dest.txt");
      expect(content).toBe("content");
    });

    it("should copy between different mounts", async () => {
      const mount1 = new InMemoryFs({ "/src.txt": "content" });
      const mount2 = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      await fs.cp("/mnt/a/src.txt", "/mnt/b/dest.txt");

      const content = await mount2.readFile("/dest.txt");
      expect(content).toBe("content");
    });

    it("should copy directory recursively across mounts", async () => {
      const mount1 = new InMemoryFs();
      await mount1.mkdir("/dir");
      await mount1.writeFile("/dir/a.txt", "a");
      await mount1.writeFile("/dir/b.txt", "b");

      const mount2 = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      await fs.cp("/mnt/a/dir", "/mnt/b/dir", { recursive: true });

      expect(await mount2.readFile("/dir/a.txt")).toBe("a");
      expect(await mount2.readFile("/dir/b.txt")).toBe("b");
    });

    it("should preserve file mode on cross-mount copy", async () => {
      const mount1 = new InMemoryFs();
      await mount1.writeFile("/script.sh", "#!/bin/bash");
      await mount1.chmod("/script.sh", 0o755);

      const mount2 = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      await fs.cp("/mnt/a/script.sh", "/mnt/b/script.sh");

      const stat = await mount2.stat("/script.sh");
      expect(stat.mode).toBe(0o755);
    });

    it("should copy within same mount using native cp", async () => {
      const mounted = new InMemoryFs({ "/src.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.cp("/mnt/data/src.txt", "/mnt/data/dest.txt");

      const content = await mounted.readFile("/dest.txt");
      expect(content).toBe("content");
    });
  });

  describe("cross-mount move", () => {
    it("should move file across mounts", async () => {
      const mount1 = new InMemoryFs({ "/src.txt": "content" });
      const mount2 = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      await fs.mv("/mnt/a/src.txt", "/mnt/b/dest.txt");

      expect(await mount2.readFile("/dest.txt")).toBe("content");
      expect(await mount1.exists("/src.txt")).toBe(false);
    });

    it("should throw when moving mount point", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await expect(fs.mv("/mnt/data", "/mnt/other")).rejects.toThrow(
        "EBUSY: mount point",
      );
    });

    it("should move within same mount using native mv", async () => {
      const mounted = new InMemoryFs({ "/src.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.mv("/mnt/data/src.txt", "/mnt/data/dest.txt");

      expect(await mounted.readFile("/dest.txt")).toBe("content");
      expect(await mounted.exists("/src.txt")).toBe(false);
    });
  });

  describe("getAllPaths", () => {
    it("should return paths from base filesystem", () => {
      const base = new InMemoryFs({
        "/a.txt": "a",
        "/b.txt": "b",
      });
      const fs = new MountableFs({ base });

      const paths = fs.getAllPaths();
      expect(paths).toContain("/a.txt");
      expect(paths).toContain("/b.txt");
    });

    it("should return paths from mounted filesystems with prefix", () => {
      const mounted = new InMemoryFs({
        "/file.txt": "content",
      });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const paths = fs.getAllPaths();
      expect(paths).toContain("/mnt/data/file.txt");
    });

    it("should include mount point parent directories", () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const paths = fs.getAllPaths();
      expect(paths).toContain("/mnt");
      expect(paths).toContain("/mnt/data");
    });

    it("should handle multiple mounts", () => {
      const mount1 = new InMemoryFs({ "/a.txt": "a" });
      const mount2 = new InMemoryFs({ "/b.txt": "b" });
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      const paths = fs.getAllPaths();
      expect(paths).toContain("/mnt/a/a.txt");
      expect(paths).toContain("/mnt/b/b.txt");
    });
  });

  describe("symlink operations", () => {
    it("should create symlink in mounted filesystem", async () => {
      const mounted = new InMemoryFs({ "/target.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.symlink("/target.txt", "/mnt/data/link.txt");

      const target = await mounted.readlink("/link.txt");
      expect(target).toBe("/target.txt");
    });

    it("should follow symlinks within same mount", async () => {
      const mounted = new InMemoryFs();
      await mounted.writeFile("/target.txt", "content");
      await mounted.symlink("/target.txt", "/link.txt");

      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      // Reading the link should resolve to target within same mount
      const content = await fs.readFile("/mnt/data/link.txt");
      expect(content).toBe("content");
    });

    it("should read symlink target via readlink across mounts", async () => {
      const mount1 = new InMemoryFs({ "/target.txt": "content" });
      const mount2 = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      // Create a symlink in mount2 pointing to file in mount1
      await mount2.symlink("/mnt/a/target.txt", "/link.txt");

      // readlink returns the target path (doesn't follow it)
      const target = await fs.readlink("/mnt/b/link.txt");
      expect(target).toBe("/mnt/a/target.txt");

      // To follow cross-mount symlinks, user must read target path explicitly
      const content = await fs.readFile(target);
      expect(content).toBe("content");
    });

    it("should copy symlinks across mounts", async () => {
      const mount1 = new InMemoryFs();
      await mount1.writeFile("/target.txt", "content");
      await mount1.symlink("/target.txt", "/link.txt");

      const mount2 = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      await fs.cp("/mnt/a/link.txt", "/mnt/b/link.txt");

      const target = await mount2.readlink("/link.txt");
      expect(target).toBe("/target.txt");
    });
  });

  describe("hard link operations", () => {
    it("should create hard link within same mount", async () => {
      const mounted = new InMemoryFs({ "/original.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.link("/mnt/data/original.txt", "/mnt/data/hardlink.txt");

      const content = await fs.readFile("/mnt/data/hardlink.txt");
      expect(content).toBe("content");
    });

    it("should throw for cross-mount hard links", async () => {
      const mount1 = new InMemoryFs({ "/file.txt": "content" });
      const mount2 = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/a", mount1);
      fs.mount("/mnt/b", mount2);

      await expect(
        fs.link("/mnt/a/file.txt", "/mnt/b/link.txt"),
      ).rejects.toThrow("EXDEV: cross-device link not permitted");
    });
  });

  describe("stat and exists", () => {
    it("should stat mount point as directory", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const stat = await fs.stat("/mnt/data");
      expect(stat.isDirectory).toBe(true);
    });

    it("should stat virtual parent directories of mounts", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const stat = await fs.stat("/mnt");
      expect(stat.isDirectory).toBe(true);
    });

    it("should report mount points as existing", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      expect(await fs.exists("/mnt/data")).toBe(true);
      expect(await fs.exists("/mnt")).toBe(true);
    });

    it("should stat files in mounted filesystem", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "hello" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const stat = await fs.stat("/mnt/data/test.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.size).toBe(5);
    });

    it("should lstat files in mounted filesystem", async () => {
      const mounted = new InMemoryFs();
      await mounted.writeFile("/target.txt", "content");
      await mounted.symlink("/target.txt", "/link.txt");

      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const stat = await fs.lstat("/mnt/data/link.txt");
      expect(stat.isSymbolicLink).toBe(true);
    });
  });

  describe("appendFile", () => {
    it("should append to file in mounted filesystem", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "hello" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.appendFile("/mnt/data/test.txt", " world");

      const content = await fs.readFile("/mnt/data/test.txt");
      expect(content).toBe("hello world");
    });
  });

  describe("chmod", () => {
    it("should chmod file in mounted filesystem", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.chmod("/mnt/data/test.txt", 0o755);

      const stat = await mounted.stat("/test.txt");
      expect(stat.mode).toBe(0o755);
    });

    it("should chmod mount point root", async () => {
      const mounted = new InMemoryFs();
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      await fs.chmod("/mnt/data", 0o700);

      const stat = await mounted.stat("/");
      expect(stat.mode).toBe(0o700);
    });
  });

  describe("resolvePath", () => {
    it("should resolve absolute paths", () => {
      const fs = new MountableFs();
      const resolved = fs.resolvePath("/some/base", "/absolute/path");
      expect(resolved).toBe("/absolute/path");
    });

    it("should resolve relative paths", () => {
      const fs = new MountableFs();
      const resolved = fs.resolvePath("/some/base", "relative/path");
      expect(resolved).toBe("/some/base/relative/path");
    });

    it("should handle . and .. in paths", () => {
      const fs = new MountableFs();
      const resolved = fs.resolvePath("/some/base", "../other/./path");
      expect(resolved).toBe("/some/other/path");
    });
  });

  describe("edge cases", () => {
    it("should handle trailing slashes in mount points", () => {
      const fs = new MountableFs();
      const mounted = new InMemoryFs();

      fs.mount("/mnt/data/", mounted);

      expect(fs.isMountPoint("/mnt/data")).toBe(true);
      expect(fs.isMountPoint("/mnt/data/")).toBe(true);
    });

    it("should handle paths without leading slash", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "content" });
      const fs = new MountableFs();
      fs.mount("mnt/data", mounted);

      const content = await fs.readFile("mnt/data/test.txt");
      expect(content).toBe("content");
    });

    it("should normalize paths with . and ..", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      const content = await fs.readFile("/mnt/data/../data/./test.txt");
      expect(content).toBe("content");
    });

    it("should handle empty base filesystem with mount", async () => {
      const mounted = new InMemoryFs({ "/test.txt": "content" });
      const fs = new MountableFs();
      fs.mount("/mnt/data", mounted);

      // Base fs is empty but mount parent should still work
      const entries = await fs.readdir("/mnt");
      expect(entries).toContain("data");
    });
  });
});
