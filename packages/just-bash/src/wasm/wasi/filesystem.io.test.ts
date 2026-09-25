import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { ExecutionScope } from "../../execution-scope.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import { resolveLimits } from "../../limits.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

const limits = {
  timeoutMs: 1000,
  maxFileBytes: 2 * 1024 * 1024,
  maxMemoryBytes: 65536,
  maxModuleBytes: 1024,
  maxTableElements: 100,
};
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function host(fs: InMemoryFs, executionScope?: ExecutionScope): WasiFileSystem {
  return new WasiFileSystem(
    createCommandContext({ fs, executionScope }),
    limits,
  );
}

async function open(
  bridge: WasiFileSystem,
  path: string,
  rights = WASI.RIGHTS_FD_READ,
): Promise<number> {
  const result = await bridge.request({
    type: "request",
    op: "open",
    fd: 3,
    path,
    lookupFlags: 1,
    openFlags: 0,
    rights: String(rights),
    inheritingRights: "0",
    flags: 0,
  });
  return JSON.parse(decoder.decode(result)) as number;
}

describe("WASI file I/O", () => {
  it("does not extend a file for zero-length writes beyond EOF", async () => {
    const fs = new InMemoryFs({ "/data": "abc" });
    const bridge = host(fs);
    try {
      const fd = await open(
        bridge,
        "data",
        WASI.RIGHTS_FD_WRITE | WASI.RIGHTS_FD_SEEK | WASI.RIGHTS_FD_TELL,
      );
      const write = (offset?: number) =>
        bridge.request({
          type: "request",
          op: "write",
          fd,
          data: new Uint8Array(),
          offset,
        });
      expect(decoder.decode(await write(100))).toBe("0");
      await bridge.request({
        type: "request",
        op: "seek",
        fd,
        offset: "100",
        whence: 0,
      });
      expect(decoder.decode(await write())).toBe("0");
      expect(
        decoder.decode(
          await bridge.request({ type: "request", op: "tell", fd }),
        ),
      ).toBe("100");
      expect((await fs.stat("/data")).size).toBe(3);
      expect(await fs.readFile("/data")).toBe("abc");
    } finally {
      bridge.close();
    }
  });

  it("rejects invalid write payloads before output accounting", async () => {
    const bridge = new WasiFileSystem(
      createCommandContext({
        fs: new InMemoryFs(),
        executionLimits: { maxOutputSize: 2 },
      }),
      limits,
    );
    try {
      await expect(
        bridge.request({
          type: "request",
          op: "write",
          fd: 1,
          data: 0 as unknown as Uint8Array,
        }),
      ).rejects.toMatchObject({ errno: WASI.ERRNO_INVAL });
      expect(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "write",
            fd: 1,
            data: encoder.encode("ab"),
          }),
        ),
      ).toBe("2");
      await expect(
        bridge.request({
          type: "request",
          op: "write",
          fd: 1,
          data: encoder.encode("c"),
        }),
      ).rejects.toThrow("WASI output limit exceeded");
      expect(bridge.stdout).toBe("ab");
    } finally {
      bridge.close();
    }
  });

  it("loads a large file once for repeated small reads", async () => {
    const fs = new InMemoryFs({ "/data": "x".repeat(1024 * 1024) });
    const original = fs.readFileBuffer.bind(fs);
    let hostBytes = 0;
    fs.readFileBuffer = async (path) => {
      const bytes = await original(path);
      hostBytes += bytes.length;
      return bytes;
    };
    const bridge = host(fs);
    try {
      const fd = await open(bridge, "data");
      for (let i = 0; i < 3; i++) {
        const result = await bridge.request({
          type: "request",
          op: "read",
          fd,
          size: 1,
        });
        expect(decoder.decode(result)).toBe("x");
      }
      expect(hostBytes).toBe(1024 * 1024);
    } finally {
      bridge.close();
    }
  });

  it("keeps reads current after writes, append, and truncate", async () => {
    const fs = new InMemoryFs({ "/data": "abc" });
    const original = fs.readFileBuffer.bind(fs);
    let reads = 0;
    fs.readFileBuffer = async (path) => {
      reads++;
      return original(path);
    };
    const bridge = host(fs);
    try {
      const fd = await open(
        bridge,
        "data",
        WASI.RIGHTS_FD_READ |
          WASI.RIGHTS_FD_WRITE |
          WASI.RIGHTS_FD_FILESTAT_SET_SIZE,
      );
      const read = (size: number) =>
        bridge.request({ type: "request", op: "read", fd, size, offset: 0 });
      expect(decoder.decode(await read(3))).toBe("abc");
      await bridge.request({
        type: "request",
        op: "write",
        fd,
        data: encoder.encode("Z"),
        offset: 1,
      });
      expect(decoder.decode(await read(3))).toBe("aZc");
      expect(reads).toBe(1);

      await bridge.request({
        type: "request",
        op: "write",
        fd,
        data: encoder.encode("d"),
        offset: 3,
      });
      expect(decoder.decode(await read(4))).toBe("aZcd");
      expect(reads).toBe(2);

      await bridge.request({ type: "request", op: "resize", fd, size: 2 });
      expect(decoder.decode(await read(4))).toBe("aZ");
      expect(reads).toBe(2);
    } finally {
      bridge.close();
    }
  });

  it("shares the latest file contents between descriptors", async () => {
    const fs = new InMemoryFs({ "/data": "old" });
    const bridge = host(fs);
    try {
      const reader = await open(bridge, "data");
      const writer = await open(bridge, "data", WASI.RIGHTS_FD_WRITE);
      expect(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd: reader,
            size: 3,
            offset: 0,
          }),
        ),
      ).toBe("old");
      await bridge.request({
        type: "request",
        op: "write",
        fd: writer,
        data: encoder.encode("new"),
        offset: 0,
      });
      expect(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "read",
            fd: reader,
            size: 3,
            offset: 0,
          }),
        ),
      ).toBe("new");
    } finally {
      bridge.close();
    }
  });

  it("releases a prior file snapshot when reading another file", async () => {
    const fileSize = 1024 * 1024;
    const maxLiveBytes = fileSize + fileSize / 2;
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes }));
    const fs = new InMemoryFs({
      "/first": "a".repeat(fileSize),
      "/second": "b".repeat(fileSize),
    });
    const bridge = host(fs, scope);
    try {
      for (const [name, expected] of [
        ["first", "a"],
        ["second", "b"],
        ["first", "a"],
      ]) {
        const fd = await open(bridge, name);
        const bytes = await bridge.request({
          type: "request",
          op: "read",
          fd,
          size: 1,
        });
        expect(decoder.decode(bytes)).toBe(expected);
      }
    } finally {
      bridge.close();
    }
    expect(scope.remainingLiveBytes).toBe(maxLiveBytes);
  });
});
