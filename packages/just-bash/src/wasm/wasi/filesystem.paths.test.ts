import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

const rights = String((1n << 28n) - 1n);
const decoder = new TextDecoder();

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
  fd = 3,
): Promise<number> {
  const result = await bridge.request({
    type: "request",
    op: "open",
    fd,
    path,
    lookupFlags: 1,
    openFlags: 0,
    rights,
    inheritingRights: rights,
    flags: 0,
  });
  return JSON.parse(decoder.decode(result)) as number;
}

describe("WASI path traversal", () => {
  it("requires each intermediate component to be a directory", async () => {
    const fs = new InMemoryFs({ "/file": "text", "/target": "content" });
    const bridge = host(fs);
    try {
      await expect(open(bridge, "file/../target")).rejects.toMatchObject({
        errno: WASI.ERRNO_NOTDIR,
      });
      await expect(open(bridge, "file/.")).rejects.toMatchObject({
        errno: WASI.ERRNO_NOTDIR,
      });
      await expect(open(bridge, "file/")).rejects.toMatchObject({
        errno: WASI.ERRNO_NOTDIR,
      });
      await expect(open(bridge, "missing/../target")).rejects.toThrow("ENOENT");
    } finally {
      bridge.close();
    }
  });

  it("resolves dot-dot from a symlink's target directory", async () => {
    const fs = new InMemoryFs({
      "/safe/target": "lexical",
      "/safe/nested/target": "physical",
      "/safe/nested/child/file": "exists",
    });
    await fs.symlink("/safe/nested/child", "/safe/link");
    const bridge = host(fs);
    try {
      const dir = await open(bridge, "safe");
      const file = await open(bridge, "link/../target", dir);
      expect(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd: file,
            size: 16,
          }),
        ),
      ).toBe("physical");
      const parent = await open(bridge, "link/../../target", dir);
      expect(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd: parent,
            size: 16,
          }),
        ),
      ).toBe("lexical");
    } finally {
      bridge.close();
    }
  });

  it("rejects a symlink excursion outside a directory capability", async () => {
    const fs = new InMemoryFs({
      "/safe/target": "local",
      "/outside/target": "private",
      "/outside/child/file": "exists",
    });
    await fs.symlink("/outside/child", "/safe/link");
    const bridge = host(fs);
    try {
      const dir = await open(bridge, "safe");
      await expect(open(bridge, "link/../target", dir)).rejects.toMatchObject({
        errno: WASI.ERRNO_NOTCAPABLE,
      });
    } finally {
      bridge.close();
    }
  });
});
