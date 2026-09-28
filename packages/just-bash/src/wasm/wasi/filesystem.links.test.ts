import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const rights = String(
  WASI.RIGHTS_FD_READ | WASI.RIGHTS_FD_WRITE | WASI.RIGHTS_FD_FILESTAT_SET_SIZE,
);

function host(fs: InMemoryFs): WasiFileSystem {
  return new WasiFileSystem(createCommandContext({ fs }), {
    timeoutMs: 1000,
    maxFileBytes: 1024,
    maxMemoryBytes: 65536,
    maxModuleBytes: 1024,
    maxTableElements: 100,
  });
}

async function open(bridge: WasiFileSystem, path: string): Promise<number> {
  const result = await bridge.request({
    type: "request",
    op: "open",
    fd: 3,
    path,
    lookupFlags: 1,
    openFlags: 0,
    rights,
    inheritingRights: "0",
    flags: 0,
  });
  return JSON.parse(decoder.decode(result)) as number;
}

describe("WASI hard links", () => {
  it("accepts a same-inode rename while its target name is open", async () => {
    const fs = new InMemoryFs({ "/original": "abc" });
    await fs.link("/original", "/alias");
    const bridge = host(fs);
    try {
      const alias = await open(bridge, "alias");
      await bridge.request({
        type: "request",
        op: "rename",
        fd: 3,
        path: "original",
        targetFd: 3,
        targetPath: "alias",
      });
      expect(await fs.readFile("/original")).toBe("abc");
      expect(await fs.readFile("/alias")).toBe("abc");
      expect(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd: alias,
            size: 3,
          }),
        ),
      ).toBe("abc");
    } finally {
      bridge.close();
    }
  });

  it("does not retarget the source descriptor on a same-inode rename", async () => {
    const fs = new InMemoryFs({ "/original": "abc" });
    await fs.link("/original", "/alias");
    const bridge = host(fs);
    try {
      const original = await open(bridge, "original");
      await bridge.request({
        type: "request",
        op: "rename",
        fd: 3,
        path: "original",
        targetFd: 3,
        targetPath: "alias",
      });
      await expect(
        bridge.request({
          type: "request",
          op: "unlink",
          fd: 3,
          path: "original",
        }),
      ).rejects.toMatchObject({ errno: WASI.ERRNO_BUSY });
      expect(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd: original,
            size: 3,
          }),
        ),
      ).toBe("abc");
    } finally {
      bridge.close();
    }
  });

  it("keeps both names when renaming a hard link over its sibling", async () => {
    const fs = new InMemoryFs({ "/original": "abc" });
    const bridge = host(fs);
    try {
      await bridge.request({
        type: "request",
        op: "link",
        fd: 3,
        path: "original",
        targetFd: 3,
        targetPath: "alias",
        flags: 0,
      });
      await bridge.request({
        type: "request",
        op: "rename",
        fd: 3,
        path: "original",
        targetFd: 3,
        targetPath: "alias",
      });
      expect(await fs.readFile("/original")).toBe("abc");
      expect(await fs.readFile("/alias")).toBe("abc");
      expect((await fs.stat("/original")).identity).toBe(
        (await fs.stat("/alias")).identity,
      );
    } finally {
      bridge.close();
    }
  });

  it("keeps linked paths coherent after writes and truncation", async () => {
    const fs = new InMemoryFs({ "/original": "abc" });
    const bridge = host(fs);
    try {
      await bridge.request({
        type: "request",
        op: "link",
        fd: 3,
        path: "original",
        targetFd: 3,
        targetPath: "alias",
        flags: 0,
      });
      const original = await open(bridge, "original");
      const alias = await open(bridge, "alias");
      const read = (fd: number) =>
        bridge.request({
          type: "request",
          op: "read",
          fd,
          size: 10,
          offset: 0,
        });
      await bridge.request({
        type: "request",
        op: "write",
        fd: original,
        data: encoder.encode("Z"),
        offset: 1,
      });
      expect(decoder.decode(await read(alias))).toBe("aZc");
      await bridge.request({
        type: "request",
        op: "write",
        fd: alias,
        data: encoder.encode("Q"),
        offset: 2,
      });
      expect(decoder.decode(await read(original))).toBe("aZQ");
      await bridge.request({
        type: "request",
        op: "resize",
        fd: alias,
        size: 2,
      });
      expect(decoder.decode(await read(original))).toBe("aZ");
      expect((await fs.stat("/alias")).identity).toBe(
        (await fs.stat("/original")).identity,
      );
    } finally {
      bridge.close();
    }
  });
});
