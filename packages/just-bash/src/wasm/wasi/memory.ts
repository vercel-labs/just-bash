import * as WASI from "./abi.js";

/** Recoverable WASI errno, distinct from a trap or host bridge failure. */
export class WasiFault extends Error {
  constructor(readonly errno: number) {
    super(`WASI errno ${errno}`);
  }
}

/** Checked little-endian access to the Preview 1 wasm32 ABI. */
export class WasiMemory {
  private memory?: WebAssembly.Memory;

  bind(instance: WebAssembly.Instance): void {
    if (!(instance.exports.memory instanceof WebAssembly.Memory))
      throw new Error("WASI modules must export memory");
    this.memory = instance.exports.memory;
  }

  bytes(pointer: number, length: number): Uint8Array {
    if (!this.memory) throw new Error("WASI memory is not initialized");
    pointer >>>= 0;
    // Derived lengths must be checked before any 32-bit truncation.
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      pointer > this.memory.buffer.byteLength ||
      length > this.memory.buffer.byteLength - pointer
    )
      throw new WasiFault(WASI.ERRNO_FAULT);
    return new Uint8Array(this.memory.buffer, pointer, length);
  }

  view(pointer: number, length: number): DataView {
    const bytes = this.bytes(pointer, length);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u32(pointer: number, value: number): void {
    this.view(pointer, 4).setUint32(0, value, true);
  }
  u64(pointer: number, value: bigint): void {
    this.view(pointer, 8).setBigUint64(0, value, true);
  }
  read32(pointer: number): number {
    return this.view(pointer, 4).getUint32(0, true);
  }

  path(pointer: number, length: number): string {
    length >>>= 0;
    if (length > 4096) throw new WasiFault(WASI.ERRNO_NAMETOOLONG);
    const bytes = this.bytes(pointer, length);
    let path: string;
    try {
      path = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new WasiFault(WASI.ERRNO_ILSEQ);
    }
    if (path.includes("\0")) throw new WasiFault(WASI.ERRNO_INVAL);
    return path;
  }

  filestat(pointer: number, stat: WASI.Filestat): void {
    const view = this.view(pointer, 64);
    this.bytes(pointer, 64).fill(0);
    view.setBigUint64(0, stat.dev, true);
    view.setBigUint64(8, stat.ino, true);
    view.setUint8(16, stat.filetype);
    view.setBigUint64(24, stat.nlink, true);
    view.setBigUint64(32, stat.size, true);
    view.setBigUint64(40, stat.atim, true);
    view.setBigUint64(48, stat.mtim, true);
    view.setBigUint64(56, stat.ctim, true);
  }

  fdstat(pointer: number, stat: WASI.Fdstat): void {
    const view = this.view(pointer, 24);
    this.bytes(pointer, 24).fill(0);
    view.setUint8(0, stat.fs_filetype);
    view.setUint16(2, stat.fs_flags, true);
    view.setBigUint64(8, stat.fs_rights_base, true);
    view.setBigUint64(16, stat.fs_rights_inherited, true);
  }
}

export function guard<T extends (...args: never[]) => number>(fn: T): T {
  return ((...args: Parameters<T>): number => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof WasiFault) return error.errno;
      throw error;
    }
  }) as T;
}
