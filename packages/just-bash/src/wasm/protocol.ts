import { _Atomics } from "../security/trusted-globals.js";

// One bounded request at a time. Only the worker blocks; the host uses its
// ordinary asynchronous IFileSystem. The guest never receives this buffer.
export const RPC_BYTES: number = 64 * 1024;
export const HEADER_BYTES = 16;
const READY = 1;
export const CLOSED = 2;

export function respond(
  buffer: SharedArrayBuffer,
  errno: number,
  data: Uint8Array,
): void {
  if (data.byteLength > RPC_BYTES) throw new Error("WASI response too large");
  const header = new Int32Array(buffer, 0, 4);
  new Uint8Array(buffer, HEADER_BYTES).set(data);
  _Atomics.store(header, 1, errno);
  _Atomics.store(header, 2, data.byteLength);
  _Atomics.store(header, 0, READY);
  _Atomics.notify(header, 0);
}
