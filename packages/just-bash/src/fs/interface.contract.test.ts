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

  it("creates entries exclusively and privately via createExclusive", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/tmp", { recursive: true });

    await fs.createExclusive("/tmp/private.txt", { mode: 0o600 });
    await fs.createExclusive("/tmp/private-dir", {
      mode: 0o700,
      directory: true,
    });

    const file = await fs.stat("/tmp/private.txt");
    expect(file.isFile).toBe(true);
    expect(file.mode & 0o777).toBe(0o600);
    expect(await fs.readFile("/tmp/private.txt")).toBe("");

    const dir = await fs.stat("/tmp/private-dir");
    expect(dir.isDirectory).toBe(true);
    expect(dir.mode & 0o777).toBe(0o700);
  });

  it("refuses createExclusive on an occupied name and keeps its contents", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/tmp", { recursive: true });
    await fs.writeFile("/tmp/taken.txt", "original");

    await expect(
      fs.createExclusive("/tmp/taken.txt", { mode: 0o600 }),
    ).rejects.toThrow("EEXIST");
    expect(await fs.readFile("/tmp/taken.txt")).toBe("original");

    await expect(
      fs.createExclusive("/tmp/missing/file.txt", { mode: 0o600 }),
    ).rejects.toThrow("ENOENT");
  });

  it("treats a symlink occupying a createExclusive name as a collision", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/tmp", { recursive: true });
    await fs.writeFile("/tmp/victim.txt", "untouched");
    await fs.symlink("/tmp/victim.txt", "/tmp/link.txt");

    await expect(
      fs.createExclusive("/tmp/link.txt", { mode: 0o600 }),
    ).rejects.toThrow("EEXIST");
    expect(await fs.readFile("/tmp/victim.txt")).toBe("untouched");
  });

  it("resolves symlinked parents but not the final component", async () => {
    const fs = new InMemoryFs();
    await fs.mkdir("/real", { recursive: true });
    await fs.symlink("/real", "/link");

    await fs.createExclusive("/link/file.txt", { mode: 0o600 });

    // Reachable through both the symlink and the resolved directory: the
    // entry must not be stored under the unresolved key.
    expect(await fs.exists("/link/file.txt")).toBe(true);
    expect(await fs.exists("/real/file.txt")).toBe(true);
    expect(await fs.readdir("/real")).toEqual(["file.txt"]);
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
