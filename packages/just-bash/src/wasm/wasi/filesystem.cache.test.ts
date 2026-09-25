import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

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

async function open(bridge: WasiFileSystem): Promise<number> {
  return JSON.parse(
    decoder.decode(
      await bridge.request({
        type: "request",
        op: "open",
        fd: 3,
        path: "original",
        lookupFlags: 1,
        openFlags: 0,
        rights: String(WASI.RIGHTS_FD_READ),
        inheritingRights: "0",
        flags: 0,
      }),
    ),
  ) as number;
}

describe("WASI file cache coherence", () => {
  it("notices a same-size hard-link write with a preserved mtime", async () => {
    const fs = new InMemoryFs({ "/original": "one" });
    await fs.link("/original", "/alias");
    const originalRead = fs.readFileBuffer.bind(fs);
    let reads = 0;
    fs.readFileBuffer = async (path) => {
      reads++;
      return originalRead(path);
    };
    const bridge = host(fs);
    try {
      const fd = await open(bridge);
      const read = async () =>
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd,
            size: 3,
            offset: 0,
          }),
        );
      expect(await read()).toBe("one");
      const mtime = (await fs.stat("/original")).mtime;
      fs.writeFileSync("/alias", "two", undefined, { mtime });
      expect(await read()).toBe("two");
      expect(await read()).toBe("two");
      expect(reads).toBe(2);
    } finally {
      bridge.close();
    }
  });

  it("reloads files from backends without a content version", async () => {
    const fs = new InMemoryFs({ "/original": "one" });
    await fs.link("/original", "/alias");
    const originalStat = fs.stat.bind(fs);
    fs.stat = async (path) => ({
      ...(await originalStat(path)),
      contentVersion: undefined,
    });
    const bridge = host(fs);
    try {
      const fd = await open(bridge);
      const read = async () =>
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd,
            size: 3,
            offset: 0,
          }),
        );
      expect(await read()).toBe("one");
      const mtime = (await fs.stat("/original")).mtime;
      fs.writeFileSync("/alias", "two", undefined, { mtime });
      expect(await read()).toBe("two");
    } finally {
      bridge.close();
    }
  });
});
