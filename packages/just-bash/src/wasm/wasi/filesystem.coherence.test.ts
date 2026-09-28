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

describe("WASI file read coherence", () => {
  it("copies the requested bytes even when the backend returns a Node buffer", async () => {
    const fs = new InMemoryFs({ "/original": Buffer.from("one") });
    const bridge = host(fs);
    try {
      const fd = await open(bridge);
      const bytes = await bridge.request({
        type: "request",
        op: "read",
        fd,
        size: 3,
      });
      expect(decoder.decode(bytes)).toBe("one");
      bytes.fill(0);
      expect(await fs.readFile("/original")).toBe("one");
    } finally {
      bridge.close();
    }
  });

  it("notices a same-size hard-link write with a preserved mtime", async () => {
    const fs = new InMemoryFs({ "/original": "one" });
    await fs.link("/original", "/alias");
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
    } finally {
      bridge.close();
    }
  });

  it("notices mutations through a borrowed buffer without changing mtime", async () => {
    const fs = new InMemoryFs({ "/original": "one" });
    await fs.link("/original", "/alias");
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
      const stat = await fs.stat("/original");
      const bytes = await fs.readFileBuffer("/alias");
      bytes.set(new TextEncoder().encode("two"));
      expect(await fs.stat("/original")).toEqual(stat);
      expect(await read()).toBe("two");
    } finally {
      bridge.close();
    }
  });
});
