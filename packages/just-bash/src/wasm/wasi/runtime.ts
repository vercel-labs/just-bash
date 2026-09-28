import { utf8ByteLength } from "../../encoding.js";
import { limitModule } from "../module.js";
import { Rpc } from "../rpc.js";
import type { WorkerInput, WorkerMessage } from "../worker-types.js";
import * as WASI from "./abi.js";
import { guard, WasiMemory } from "./memory.js";
import { filesystemImports } from "./runtime-fs.js";
import type { WasiContext } from "./types.js";

class WasiExit extends Error {
  constructor(readonly status: number) {
    super("WASI process exited");
  }
}

/** Our Preview 1 implementation, operating only on the virtual host bridge. */
export function createWasiRuntime(input: WorkerInput, rpc: Rpc): WasiContext {
  const memory = new WasiMemory();
  const encoder = new TextEncoder();
  const stringSize = (values: string[]): number =>
    values.reduce((size, value) => size + utf8ByteLength(value) + 1, 0);
  const sizes = (values: string[], count: number, bytes: number): number => {
    memory.bytes(count, 4);
    memory.bytes(bytes, 4);
    memory.u32(count, values.length);
    memory.u32(bytes, stringSize(values));
    return 0;
  };
  const strings = (
    values: string[],
    pointers: number,
    buffer: number,
  ): number => {
    pointers >>>= 0;
    buffer >>>= 0;
    memory.bytes(pointers, values.length * 4);
    const target = memory.bytes(buffer, stringSize(values));
    let offset = 0;
    for (let i = 0; i < values.length; i++) {
      memory.u32(pointers + i * 4, buffer + offset);
      const { written } = encoder.encodeInto(
        values[i],
        target.subarray(offset),
      );
      offset += written;
      target[offset++] = 0;
    }
    return 0;
  };
  const unsupported = (): number => WASI.ERRNO_NOTSUP;
  const functions = {
    ...filesystemImports(memory, rpc),
    args_sizes_get: (count: number, bytes: number) =>
      sizes(input.args, count, bytes),
    args_get: (pointers: number, buffer: number) =>
      strings(input.args, pointers, buffer),
    environ_sizes_get: (count: number, bytes: number) =>
      sizes(input.env, count, bytes),
    environ_get: (pointers: number, buffer: number) =>
      strings(input.env, pointers, buffer),
    clock_res_get(id: number, out: number) {
      if (id !== 0 && id !== 1) return WASI.ERRNO_INVAL;
      memory.u64(out, id === 0 ? 1_000_000n : 1_000n);
      return 0;
    },
    clock_time_get(id: number, _precision: bigint, out: number) {
      if (id !== 0 && id !== 1) return WASI.ERRNO_INVAL;
      const time =
        id === 0
          ? BigInt(Date.now()) * 1_000_000n
          : BigInt(Math.floor(performance.now() * 1_000_000));
      memory.u64(out, time);
      return 0;
    },
    random_get(pointer: number, length: number) {
      const target = memory.bytes(pointer, length >>> 0);
      if (!globalThis.crypto?.getRandomValues) return WASI.ERRNO_NOTSUP;
      for (let offset = 0; offset < target.length; offset += 65536)
        globalThis.crypto.getRandomValues(
          target.subarray(offset, offset + 65536),
        );
      return 0;
    },
    proc_exit(status: number): never {
      throw new WasiExit(status >>> 0);
    },
    sched_yield: () => 0,
    proc_raise: unsupported,
    poll_oneoff: unsupported,
    fd_advise: unsupported,
    fd_allocate: unsupported,
    fd_filestat_set_times: unsupported,
    path_filestat_set_times: unsupported,
    sock_accept: unsupported,
    sock_recv: unsupported,
    sock_send: unsupported,
    sock_shutdown: unsupported,
  };
  const imports: WebAssembly.ModuleImports = Object.create(null);
  for (const [name, fn] of Object.entries(functions)) {
    if (typeof fn !== "function")
      throw new Error("Invalid WASI import implementation");
    imports[name] = guard(fn as (...args: never[]) => number);
  }
  return {
    imports,
    start(instance) {
      memory.bind(instance);
      if (typeof instance.exports._start !== "function")
        throw new Error("WASI command must export memory and _start");
      try {
        instance.exports._start();
        return 0;
      } catch (error) {
        if (error instanceof WasiExit) return error.status;
        throw error;
      }
    },
    initialize(instance) {
      memory.bind(instance);
      if (typeof instance.exports._initialize === "function")
        instance.exports._initialize();
    },
  };
}

/** The default adapter admits only our WASI imports. */
export async function runWasi(
  input: WorkerInput,
  send: (message: WorkerMessage) => void,
): Promise<void> {
  try {
    const rpc = new Rpc(input.buffer, send, input.limits.timeoutMs);
    const wasi = createWasiRuntime(input, rpc);
    const bounded = limitModule(
      input.wasm,
      input.limits.maxMemoryBytes,
      input.limits.maxTableElements,
    );
    const module = await WebAssembly.compile(bounded);
    for (const entry of WebAssembly.Module.imports(module)) {
      if (
        entry.module !== "wasi_snapshot_preview1" ||
        entry.kind !== "function" ||
        !Object.hasOwn(wasi.imports, entry.name)
      )
        throw new Error(
          "Module requires unsupported imports; only WASI Preview 1 functions are available",
        );
    }
    const instance = await WebAssembly.instantiate(module, {
      wasi_snapshot_preview1: wasi.imports,
    });
    send({ type: "done", exitCode: wasi.start(instance) });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : "WASI execution failed",
    });
  }
}
