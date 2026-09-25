import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import { HEADER_BYTES, RPC_BYTES, respond } from "../protocol.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

function host(fs: InMemoryFs): WasiFileSystem {
  return new WasiFileSystem(createCommandContext({ fs }), {
    timeoutMs: 1000,
    maxFileBytes: 1024,
    maxMemoryBytes: 65536,
    maxModuleBytes: 1024,
    maxTableElements: 100,
  });
}

describe("WASI readlink frames", () => {
  it("returns only the requested prefix of a long target", async () => {
    const fs = new InMemoryFs();
    await fs.symlink("x".repeat(RPC_BYTES + 4096), "/link");
    const bridge = host(fs);
    try {
      const bytes = await bridge.request({
        type: "request",
        op: "readlink",
        fd: 3,
        path: "link",
        size: RPC_BYTES,
      });
      expect(bytes.length).toBe(RPC_BYTES);
      expect(new TextDecoder().decode(bytes)).toBe("x".repeat(RPC_BYTES));
      const frame = new SharedArrayBuffer(HEADER_BYTES + RPC_BYTES);
      expect(() => respond(frame, 0, bytes)).not.toThrow();
      expect(new Int32Array(frame, 0, 4)[2]).toBe(RPC_BYTES);
    } finally {
      bridge.close();
    }
  });

  it("truncates UTF-8 targets by bytes and rejects oversized requests", async () => {
    const fs = new InMemoryFs();
    await fs.symlink("🙂x", "/link");
    const bridge = host(fs);
    try {
      expect(
        await bridge.request({
          type: "request",
          op: "readlink",
          fd: 3,
          path: "link",
          size: 3,
        }),
      ).toEqual(new Uint8Array([0xf0, 0x9f, 0x99]));
      await expect(
        bridge.request({
          type: "request",
          op: "readlink",
          fd: 3,
          path: "link",
          size: RPC_BYTES + 1,
        }),
      ).rejects.toMatchObject({ errno: WASI.ERRNO_INVAL });
    } finally {
      bridge.close();
    }
  });
});
