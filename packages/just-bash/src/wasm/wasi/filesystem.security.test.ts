import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import * as WASI from "./abi.js";
import { errnoFrom, WasiFileSystem } from "./filesystem.js";

const rights = String((1n << 28n) - 1n);
function host(fs: InMemoryFs): WasiFileSystem {
  return new WasiFileSystem(createCommandContext({ fs }), {
    timeoutMs: 1000,
    maxFileBytes: 1024,
    maxMemoryBytes: 65536,
    maxModuleBytes: 1024,
    maxTableElements: 100,
  });
}
async function open(
  bridge: WasiFileSystem,
  path: string,
  base = rights,
  inheriting = rights,
  fd = 3,
): Promise<number> {
  const bytes = await bridge.request({
    type: "request",
    op: "open",
    fd,
    path,
    lookupFlags: 1,
    openFlags: 0,
    rights: base,
    inheritingRights: inheriting,
    flags: 0,
  });
  return JSON.parse(new TextDecoder().decode(bytes)) as number;
}

describe("WASI descriptor capabilities", () => {
  it("does not treat an errno in a denied path as a missing file", async () => {
    const fs = new InMemoryFs({ "/ENOENT-dir/existing": "ok" });
    const lstat = fs.lstat.bind(fs);
    fs.lstat = async (path) => {
      if (path === "/ENOENT-dir/denied")
        throw new Error(`EACCES: lstat '${path}'`);
      return lstat(path);
    };
    const bridge = host(fs);
    try {
      await expect(
        bridge.request({
          type: "request",
          op: "open",
          fd: 3,
          path: "ENOENT-dir/denied",
          lookupFlags: 0,
          openFlags: WASI.OFLAGS_CREAT,
          rights,
          inheritingRights: rights,
          flags: 0,
        }),
      ).rejects.toThrow("EACCES");
      expect(await fs.exists("/ENOENT-dir/denied")).toBe(false);
      expect(errnoFrom(new Error("EACCES: lstat '/ENOENT-dir/denied'"))).toBe(
        WASI.ERRNO_ACCES,
      );
    } finally {
      bridge.close();
    }
  });

  it("rejects directory traversal and symlink escapes from a directory descriptor", async () => {
    const fs = new InMemoryFs({ "/safe/file": "ok", "/secret": "private" });
    await fs.symlink("/secret", "/safe/link");
    const bridge = host(fs);
    const dir = await open(bridge, "safe");
    await expect(
      open(bridge, "../secret", rights, rights, dir),
    ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTCAPABLE });
    await expect(
      open(bridge, "link", rights, rights, dir),
    ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTCAPABLE });
    expect(await open(bridge, "file", rights, rights, dir)).toBeGreaterThan(
      dir,
    );
    bridge.close();
  });

  it("does not turn a dangling symlink into a write outside a directory capability", async () => {
    const fs = new InMemoryFs({ "/safe/file": "ok" });
    await fs.symlink("/created", "/safe/link");
    const bridge = host(fs);
    const dir = await open(bridge, "safe");
    await expect(
      bridge.request({
        type: "request",
        op: "open",
        fd: dir,
        path: "link",
        lookupFlags: 1,
        openFlags: WASI.OFLAGS_CREAT,
        rights,
        inheritingRights: rights,
        flags: 0,
      }),
    ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTCAPABLE });
    expect(await fs.exists("/created")).toBe(false);
    bridge.close();
  });

  it("enforces requested rights and refuses to restore reduced rights", async () => {
    const fs = new InMemoryFs({ "/file": "original" });
    const bridge = host(fs);
    const fd = await open(bridge, "file", String(WASI.RIGHTS_FD_READ), "0");
    await expect(
      bridge.request({
        type: "request",
        op: "write",
        fd,
        data: new Uint8Array([1]),
      }),
    ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTCAPABLE });
    await expect(
      bridge.request({
        type: "request",
        op: "rights",
        fd,
        rights,
        inheritingRights: "0",
      }),
    ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTCAPABLE });
    expect(await fs.readFile("/file")).toBe("original");
    bridge.close();
  });

  it("uses prototype-like filenames as ordinary virtual paths", async () => {
    const fs = new InMemoryFs({
      "/__proto__": "one",
      "/constructor": "two",
      "/prototype": "three",
    });
    const bridge = host(fs);
    for (const [name, content] of [
      ["__proto__", "one"],
      ["constructor", "two"],
      ["prototype", "three"],
    ]) {
      const fd = await open(bridge, name);
      const bytes = await bridge.request({
        type: "request",
        op: "read",
        fd,
        size: 10,
      });
      expect(new TextDecoder().decode(bytes)).toBe(content);
    }
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    bridge.close();
  });
});
