import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

const limits = {
  timeoutMs: 1000,
  maxFileBytes: 1024,
  maxMemoryBytes: 65536,
  maxModuleBytes: 1024,
  maxTableElements: 100,
};

function open(bridge: WasiFileSystem, flags = 0): Promise<Uint8Array> {
  return bridge.request({
    type: "request",
    op: "open",
    fd: 3,
    path: "special",
    lookupFlags: 1,
    openFlags: flags,
    rights: String(WASI.RIGHTS_FD_READ | WASI.RIGHTS_FD_WRITE),
    inheritingRights: "0",
    flags: 0,
  });
}

describe("WASI special file handling", () => {
  it("reports special entries as unknown and refuses to open or truncate them", async () => {
    const fs = new InMemoryFs({ "/special": "original" });
    const lstat = fs.lstat.bind(fs);
    fs.lstat = async (path) => {
      const stat = await lstat(path);
      return path === "/special" ? { ...stat, isFile: false } : stat;
    };
    const bridge = new WasiFileSystem(createCommandContext({ fs }), limits);
    try {
      const stat = JSON.parse(
        new TextDecoder().decode(
          await bridge.request({
            type: "request",
            op: "pathstat",
            fd: 3,
            path: "special",
            flags: 1,
          }),
        ),
      ) as { type: number };
      expect(stat.type).toBe(WASI.FILETYPE_UNKNOWN);
      await expect(open(bridge)).rejects.toMatchObject({
        errno: WASI.ERRNO_NOTSUP,
      });
      await expect(open(bridge, WASI.OFLAGS_TRUNC)).rejects.toMatchObject({
        errno: WASI.ERRNO_NOTSUP,
      });
      expect(await fs.readFile("/special")).toBe("original");
    } finally {
      bridge.close();
    }
  });

  it("checks the file type again before reading an existing descriptor", async () => {
    const fs = new InMemoryFs({ "/special": "original" });
    const bridge = new WasiFileSystem(createCommandContext({ fs }), limits);
    try {
      const fd = JSON.parse(
        new TextDecoder().decode(await open(bridge)),
      ) as number;
      const stat = fs.stat.bind(fs);
      fs.stat = async (path) => {
        const result = await stat(path);
        return path === "/special" ? { ...result, isFile: false } : result;
      };
      await expect(
        bridge.request({ type: "request", op: "read", fd, size: 1 }),
      ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTSUP });
      await expect(
        bridge.request({
          type: "request",
          op: "write",
          fd,
          data: new Uint8Array([65]),
        }),
      ).rejects.toMatchObject({ errno: WASI.ERRNO_NOTSUP });
      expect(await fs.readFile("/special")).toBe("original");
    } finally {
      bridge.close();
    }
  });
});
