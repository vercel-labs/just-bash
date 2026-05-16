import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";

describe("IFileSystem contract", () => {
  it("reads, writes, appends, stats, lists, and removes files", async () => {
    const fs = new InMemoryFs();

    await fs.mkdir("/docs", { recursive: true });
    await fs.writeFile("/docs/readme.md", "hello");
    await fs.appendFile("/docs/readme.md", " world");

    expect(await fs.readFile("/docs/readme.md")).toBe("hello world");
    expect(await fs.exists("/docs/readme.md")).toBe(true);
    expect((await fs.stat("/docs/readme.md")).isFile).toBe(true);
    expect(await fs.readdir("/docs")).toContain("readme.md");

    await fs.rm("/docs/readme.md");
    expect(await fs.exists("/docs/readme.md")).toBe(false);
  });

  it("copies and moves files without changing file contents", async () => {
    const fs = new InMemoryFs();

    await fs.mkdir("/tmp", { recursive: true });
    await fs.writeFile("/tmp/source.txt", "contents");
    await fs.cp("/tmp/source.txt", "/tmp/copy.txt");
    await fs.mv("/tmp/copy.txt", "/tmp/moved.txt");

    expect(await fs.readFile("/tmp/source.txt")).toBe("contents");
    expect(await fs.readFile("/tmp/moved.txt")).toBe("contents");
    expect(await fs.exists("/tmp/copy.txt")).toBe(false);
  });

  it("rejects null-byte paths for mutating and read operations", async () => {
    const fs = new InMemoryFs();

    await expect(fs.readFile("/evil\0.txt")).rejects.toThrow("null byte");
    await expect(fs.writeFile("/evil\0.txt", "data")).rejects.toThrow(
      "null byte",
    );
    await expect(fs.mkdir("/evil\0dir")).rejects.toThrow("null byte");
    await expect(fs.rm("/evil\0.txt")).rejects.toThrow("null byte");
  });

  it("clamps traversal above the virtual root", async () => {
    const fs = new InMemoryFs();

    await fs.writeFile("/root.txt", "root");

    expect(await fs.readFile("/../../root.txt")).toBe("root");
    expect((await fs.stat("/../../")).isDirectory).toBe(true);
  });

  it("resolves relative paths consistently", () => {
    const fs = new InMemoryFs();

    expect(fs.resolvePath("/work", "file.txt")).toBe("/work/file.txt");
    expect(fs.resolvePath("/work", "../file.txt")).toBe("/file.txt");
    expect(fs.resolvePath("/work", "/absolute.txt")).toBe("/absolute.txt");
  });

  it("creates symlinks and keeps absolute symlink targets virtual", async () => {
    const fs = new InMemoryFs();

    await fs.writeFile("/target.txt", "target");
    await fs.symlink("/target.txt", "/link.txt");

    expect(await fs.readlink("/link.txt")).toBe("/target.txt");
    expect((await fs.lstat("/link.txt")).isSymbolicLink).toBe(true);
    expect(await fs.readFile("/link.txt")).toBe("target");
  });
});
