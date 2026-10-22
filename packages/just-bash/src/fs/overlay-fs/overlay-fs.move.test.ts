import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayFs } from "./overlay-fs.js";

describe("OverlayFs moves", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-move-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("moves an appended file at the memory limit", async () => {
    const overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 5 });
    await overlay.writeFile("/source", "abc");
    await overlay.appendFile("/source", "de");
    const before = await overlay.lstat("/source");

    await overlay.mv("/source", "/destination");

    await expect(overlay.lstat("/source")).rejects.toThrow("ENOENT");
    expect(await overlay.readFile("/destination")).toBe("abcde");
    expect((await overlay.lstat("/destination")).ino).toBe(before.ino);
    await expect(overlay.writeFile("/another", "x")).rejects.toThrow("ENOSPC");
  });

  it("moves a directory with symlinks at the memory limit", async () => {
    const overlay = new OverlayFs({
      root,
      mountPoint: "/",
      allowSymlinks: true,
      maxMemoryBytes: 5,
    });
    await overlay.mkdir("/tree");
    await overlay.writeFile("/tree/a", "abc");
    await overlay.writeFile("/tree/b", "de");
    await overlay.symlink("a", "/tree/link");
    const before = await overlay.lstat("/tree/link");

    await overlay.mv("/tree", "/moved");

    await expect(overlay.lstat("/tree/link")).rejects.toThrow("ENOENT");
    expect(await overlay.readFile("/moved/a")).toBe("abc");
    expect(await overlay.readFile("/moved/b")).toBe("de");
    expect(await overlay.readlink("/moved/link")).toBe("a");
    expect((await overlay.lstat("/moved/link")).ino).toBe(before.ino);
  });

  it("keeps the source intact when the moved real file exceeds the memory limit", async () => {
    fs.writeFileSync(path.join(root, "source"), "abcdef");
    const overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 5 });

    await expect(overlay.mv("/source", "/destination")).rejects.toThrow(
      "ENOSPC",
    );

    expect(await overlay.readFile("/source")).toBe("abcdef");
    await expect(overlay.lstat("/destination")).rejects.toThrow("ENOENT");
  });

  it("rejects an oversized backing tree before reading file bodies", async () => {
    fs.mkdirSync(path.join(root, "tree"));
    fs.writeFileSync(path.join(root, "tree", "a"), "aaa");
    fs.writeFileSync(path.join(root, "tree", "b"), "bbb");
    const overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 5 });
    const reads = vi.spyOn(overlay, "readFileBuffer");

    await expect(overlay.mv("/tree", "/moved")).rejects.toThrow("ENOSPC");

    expect(reads).not.toHaveBeenCalled();
    expect(await overlay.readdir("/tree")).toEqual(["a", "b"]);
    await expect(overlay.lstat("/moved")).rejects.toThrow("ENOENT");
  });

  it("stops staging if a backing file grows after the size check", async () => {
    fs.mkdirSync(path.join(root, "tree"));
    fs.writeFileSync(path.join(root, "tree", "a"), "a");
    fs.writeFileSync(path.join(root, "tree", "b"), "b");
    const overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 2 });
    const originalRead = overlay.readFileBuffer.bind(overlay);
    const reads = vi
      .spyOn(overlay, "readFileBuffer")
      .mockImplementation((file) =>
        file === "/tree/a"
          ? Promise.resolve(new TextEncoder().encode("aa"))
          : originalRead(file),
      );

    await expect(overlay.mv("/tree", "/moved")).rejects.toThrow("ENOSPC");

    expect(reads.mock.calls.map(([file]) => file)).toEqual(["/tree/a"]);
    reads.mockRestore();
    expect(await overlay.readdir("/tree")).toEqual(["a", "b"]);
    await expect(overlay.lstat("/moved")).rejects.toThrow("ENOENT");
  });

  it("moves a backing tree that exactly fits the memory limit", async () => {
    fs.mkdirSync(path.join(root, "tree"));
    fs.writeFileSync(path.join(root, "tree", "a"), "abc");
    fs.writeFileSync(path.join(root, "tree", "b"), "de");
    const overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 5 });

    await overlay.mv("/tree", "/moved");

    expect(await overlay.readFile("/moved/a")).toBe("abc");
    expect(await overlay.readFile("/moved/b")).toBe("de");
    await expect(overlay.lstat("/tree")).rejects.toThrow("ENOENT");
    await expect(overlay.writeFile("/extra", "x")).rejects.toThrow("ENOSPC");
  });

  it("moves a real symlink entry without copying its target", async () => {
    fs.writeFileSync(path.join(root, "target"), "content");
    fs.symlinkSync("target", path.join(root, "link"));
    const overlay = new OverlayFs({
      root,
      mountPoint: "/",
      allowSymlinks: true,
    });

    await overlay.mv("/link", "/moved");

    await expect(overlay.lstat("/link")).rejects.toThrow("ENOENT");
    expect((await overlay.lstat("/moved")).isSymbolicLink).toBe(true);
    expect(await overlay.readlink("/moved")).toBe("target");
    expect(await overlay.readFile("/target")).toBe("content");
  });

  it("does not expose a real symlink when symlinks are disabled", async () => {
    fs.writeFileSync(path.join(root, "target"), "content");
    fs.symlinkSync("target", path.join(root, "link"));
    const overlay = new OverlayFs({ root, mountPoint: "/" });

    await expect(overlay.readFile("/link")).rejects.toThrow("ENOENT");
    await expect(overlay.mv("/link", "/moved")).rejects.toThrow("ENOENT");

    expect((await overlay.lstat("/link")).isSymbolicLink).toBe(true);
    await expect(overlay.lstat("/moved")).rejects.toThrow("ENOENT");
  });

  it("keeps a real directory intact if it contains a disabled symlink", async () => {
    fs.mkdirSync(path.join(root, "tree"));
    fs.writeFileSync(path.join(root, "tree", "target"), "content");
    fs.symlinkSync("target", path.join(root, "tree", "link"));
    const overlay = new OverlayFs({ root, mountPoint: "/" });

    await expect(overlay.mv("/tree", "/moved")).rejects.toThrow("ENOENT");

    expect(await overlay.readdir("/tree")).toEqual(["link", "target"]);
    expect(await overlay.readFile("/tree/target")).toBe("content");
    await expect(overlay.lstat("/moved")).rejects.toThrow("ENOENT");
  });
});
