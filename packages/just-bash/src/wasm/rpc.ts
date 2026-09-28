import { _Atomics } from "../security/trusted-globals.js";
import { CLOSED, HEADER_BYTES, RPC_BYTES } from "./protocol.js";
import type { WasiOperation, WasiRequest } from "./wasi/requests.js";

interface Reply<T> {
  errno: number;
  value: T | null;
}

export class Rpc {
  private readonly header: Int32Array;
  constructor(
    private readonly buffer: SharedArrayBuffer,
    private readonly send: (message: WasiRequest) => void,
    private readonly timeoutMs: number,
  ) {
    this.header = new Int32Array(buffer, 0, 4);
  }

  call(operation: WasiOperation): { errno: number; data: Uint8Array } {
    const data = operation.op === "write" ? operation.data : undefined;
    if (_Atomics.load(this.header, 0) === CLOSED)
      throw new Error("WASI execution closed");
    if (data && data.byteLength > RPC_BYTES)
      throw new Error("WASM request exceeds bridge frame limit");
    _Atomics.store(this.header, 0, 0);
    // A view into guest memory would clone its entire backing buffer. Copy
    // only this frame (also handles Buffer views supplied by Node adapters).
    const request: WasiRequest = { ...operation, type: "request" };
    if (request.op === "write") request.data = new Uint8Array(request.data);
    this.send(request);
    if (_Atomics.wait(this.header, 0, 0, this.timeoutMs) === "timed-out")
      throw new Error("WASI bridge timed out");
    if (_Atomics.load(this.header, 0) === CLOSED)
      throw new Error("WASI execution closed");
    const length = _Atomics.load(this.header, 2);
    if (length < 0 || length > RPC_BYTES)
      throw new Error("Invalid WASI response");
    return {
      errno: _Atomics.load(this.header, 1),
      data: new Uint8Array(this.buffer, HEADER_BYTES, length).slice(),
    };
  }

  json<T>(operation: WasiOperation): Reply<T> {
    const response = this.call(operation);
    return {
      errno: response.errno,
      value:
        response.errno || !response.data.length
          ? null
          : (JSON.parse(new TextDecoder().decode(response.data)) as T),
    };
  }
}
