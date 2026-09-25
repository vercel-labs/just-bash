import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { OverlayFs } from "../../fs/overlay-fs/overlay-fs.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

const rights = String((1n << 28n) - 1n);
const decoder = new TextDecoder();
const limits = {
  timeoutMs: 1000,
  maxFileBytes: 1024,
  maxMemoryBytes: 65536,
  maxModuleBytes: 1024,
  maxTableElements: 100,
};

async function open(bridge: WasiFileSystem, fd: number, filePath: string) {
  return JSON.parse(
    decoder.decode(
      await bridge.request({
        type: "request",
        op: "open",
        fd,
        path: filePath,
        lookupFlags: 1,
        openFlags: 0,
        rights,
        inheritingRights: rights,
        flags: 0,
      }),
    ),
  ) as number;
}

describe("WASI overlay symlink capabilities", () => {
  let root: string;
  let overlay: OverlayFs;
  let bridge: WasiFileSystem;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wasi-overlay-"));
    overlay = new OverlayFs({ root, mountPoint: "/", allowSymlinks: true });
    await overlay.mkdir("/safe");
    await overlay.writeFile("/private", "secret");
    await overlay.symlink("/private", "/safe/link");
    bridge = new WasiFileSystem(createCommandContext({ fs: overlay }), limits);
  });

  afterEach(() => {
    bridge?.close();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not follow a symlink for path_link without lookup follow", async () => {
    const safe = await open(bridge, 3, "safe");
    await bridge.request({ type: "request", op: "close", fd: 3 });
    await expect(open(bridge, safe, "link")).rejects.toMatchObject({
      errno: WASI.ERRNO_NOTCAPABLE,
    });

    await expect(
      bridge.request({
        type: "request",
        op: "link",
        fd: safe,
        path: "link",
        targetFd: safe,
        targetPath: "copy",
        flags: 0,
      }),
    ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTSUP });
    await expect(overlay.lstat("/safe/copy")).rejects.toThrow("ENOENT");
    expect(await overlay.readlink("/safe/link")).toBe("/private");
    expect(await overlay.readFile("/private")).toBe("secret");
  });

  it("does not copy a symlink target through OverlayFs.link directly", async () => {
    await expect(overlay.link("/safe/link", "/safe/copy")).rejects.toThrow(
      "EPERM",
    );
    await expect(overlay.lstat("/safe/copy")).rejects.toThrow("ENOENT");
    expect(await overlay.readlink("/safe/link")).toBe("/private");
    expect(await overlay.readFile("/private")).toBe("secret");
  });

  it("renames the symlink entry without reading outside the directory", async () => {
    await overlay.writeFile("/safe/replaced", "old");
    const safe = await open(bridge, 3, "safe");
    await bridge.request({ type: "request", op: "close", fd: 3 });

    await bridge.request({
      type: "request",
      op: "rename",
      fd: safe,
      path: "link",
      targetFd: safe,
      targetPath: "replaced",
    });
    await expect(overlay.lstat("/safe/link")).rejects.toThrow("ENOENT");
    expect((await overlay.lstat("/safe/replaced")).isSymbolicLink).toBe(true);
    expect(await overlay.readlink("/safe/replaced")).toBe("/private");
    await expect(open(bridge, safe, "replaced")).rejects.toMatchObject({
      errno: WASI.ERRNO_NOTCAPABLE,
    });
    expect(await overlay.readFile("/private")).toBe("secret");
  });

  it("keeps symlink descendants intact when renaming a directory", async () => {
    await overlay.mkdir("/safe/tree");
    await overlay.symlink("/private", "/safe/tree/link");
    await overlay.mkdir("/private-dir");
    await overlay.writeFile("/private-dir/data", "directory secret");
    await overlay.symlink("/private-dir", "/safe/tree/dirlink");
    const safe = await open(bridge, 3, "safe");
    await bridge.request({ type: "request", op: "close", fd: 3 });

    await bridge.request({
      type: "request",
      op: "rename",
      fd: safe,
      path: "tree",
      targetFd: safe,
      targetPath: "moved",
    });
    await expect(overlay.lstat("/safe/tree")).rejects.toThrow("ENOENT");
    expect((await overlay.lstat("/safe/moved/link")).isSymbolicLink).toBe(true);
    expect(await overlay.readlink("/safe/moved/link")).toBe("/private");
    expect((await overlay.lstat("/safe/moved/dirlink")).isSymbolicLink).toBe(
      true,
    );
    expect(await overlay.readlink("/safe/moved/dirlink")).toBe("/private-dir");
    await expect(open(bridge, safe, "moved/link")).rejects.toMatchObject({
      errno: WASI.ERRNO_NOTCAPABLE,
    });
    expect(await overlay.readFile("/private")).toBe("secret");
    expect(await overlay.readFile("/private-dir/data")).toBe(
      "directory secret",
    );
  });

  it("does not treat an overlay copy as the same inode when renaming", async () => {
    await overlay.writeFile("/safe/original", "first");
    await overlay.link("/safe/original", "/safe/copy");
    const original = await overlay.lstat("/safe/original");
    const copy = await overlay.lstat("/safe/copy");
    expect(original.identity).not.toBe(copy.identity);
    const safe = await open(bridge, 3, "safe");

    await bridge.request({
      type: "request",
      op: "rename",
      fd: safe,
      path: "original",
      targetFd: safe,
      targetPath: "copy",
    });
    await expect(overlay.lstat("/safe/original")).rejects.toThrow("ENOENT");
    expect(await overlay.readFile("/safe/copy")).toBe("first");
  });
});
