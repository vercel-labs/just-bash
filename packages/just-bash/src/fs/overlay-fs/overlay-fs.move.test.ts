import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
