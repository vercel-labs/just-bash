import { describe, expect, it } from "vitest";
import { HEADER_BYTES, RPC_BYTES, respond } from "../protocol.js";
import { Rpc } from "../rpc.js";
import { WasiMemory } from "./memory.js";
import type { WasiRequest } from "./requests.js";
import { filesystemImports } from "./runtime-fs.js";

describe("WASI path_readlink", () => {
  it("copies the bounded byte response into guest memory", () => {
    const memory = new WasiMemory();
    const linear = new WebAssembly.Memory({ initial: 2 });
    memory.bind({ exports: { memory: linear } } as WebAssembly.Instance);
    const buffer = new SharedArrayBuffer(HEADER_BYTES + RPC_BYTES);
    const requests: WasiRequest[] = [];
    const rpc = new Rpc(
      buffer,
      (request) => {
        requests.push(request);
        respond(buffer, 0, new Uint8Array([0xf0, 0x9f, 0x99]));
      },
      1000,
    );
    const readlink = filesystemImports(memory, rpc).path_readlink as (
      id: number,
      path: number,
      pathLength: number,
      output: number,
      size: number,
      out: number,
    ) => number;
    memory.bytes(0, 4).set(new TextEncoder().encode("link"));

    expect(readlink(3, 0, 4, 16, 3, 32)).toBe(0);
    expect(memory.bytes(16, 3)).toEqual(new Uint8Array([0xf0, 0x9f, 0x99]));
    expect(memory.read32(32)).toBe(3);
    expect(readlink(3, 0, 4, 64, RPC_BYTES + 1, 40)).toBe(0);
    expect(memory.read32(40)).toBe(3);
    expect(requests).toEqual([
      { type: "request", op: "readlink", fd: 3, path: "link", size: 3 },
      { type: "request", op: "readlink", fd: 3, path: "link", size: RPC_BYTES },
    ]);
  });
});
