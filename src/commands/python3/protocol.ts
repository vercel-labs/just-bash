/**
 * SharedArrayBuffer protocol for synchronous filesystem bridge
 *
 * This protocol enables synchronous filesystem access from a worker thread
 * (where Pyodide/Python runs) to the main thread (which has async IFileSystem).
 */

// Type declaration for Atomics.waitAsync (available in Node.js but not in TS lib)
declare global {
  interface Atomics {
    waitAsync(
      typedArray: Int32Array,
      index: number,
      value: number,
      timeout?: number,
    ):
      | { async: false; value: "not-equal" | "timed-out" }
      | { async: true; value: Promise<"ok" | "timed-out"> };
  }
}

/** Operation codes */
export const OpCode = {
  NOOP: 0,
  READ_FILE: 1,
  WRITE_FILE: 2,
  STAT: 3,
  READDIR: 4,
  MKDIR: 5,
  RM: 6,
  EXISTS: 7,
  APPEND_FILE: 8,
  SYMLINK: 9,
  READLINK: 10,
  LSTAT: 11,
  CHMOD: 12,
  REALPATH: 13,
  // Special operations for Python I/O
  WRITE_STDOUT: 100,
  WRITE_STDERR: 101,
  EXIT: 102,
  // HTTP operations
  HTTP_REQUEST: 200,
} as const;

export type OpCodeType = (typeof OpCode)[keyof typeof OpCode];

/** Status codes for synchronization */
export const Status = {
  PENDING: 0,
  READY: 1,
  SUCCESS: 2,
  ERROR: 3,
} as const;

export type StatusType = (typeof Status)[keyof typeof Status];

/** Error codes */
export const ErrorCode = {
  NONE: 0,
  NOT_FOUND: 1,
  IS_DIRECTORY: 2,
  NOT_DIRECTORY: 3,
  EXISTS: 4,
  PERMISSION_DENIED: 5,
  INVALID_PATH: 6,
  IO_ERROR: 7,
  TIMEOUT: 8,
  NETWORK_ERROR: 9,
  NETWORK_NOT_CONFIGURED: 10,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Buffer layout offsets */
const Offset = {
  OP_CODE: 0,
  STATUS: 4,
  PATH_LENGTH: 8,
  DATA_LENGTH: 12,
  RESULT_LENGTH: 16,
  ERROR_CODE: 20,
  FLAGS: 24,
  MODE: 28,
  PATH_BUFFER: 32,
  DATA_BUFFER: 4128, // 32 + 4096
} as const;

/** Buffer sizes */
const Size = {
  CONTROL_REGION: 32,
  PATH_BUFFER: 4096,
  DATA_BUFFER: 1048576, // 1MB (reduced from 16MB for faster tests)
  TOTAL: 1052704, // 32 + 4096 + 1MB
} as const;

/** Flags for operations */
export const Flags = {
  NONE: 0,
  RECURSIVE: 1,
  FORCE: 2,
  MKDIR_RECURSIVE: 1,
} as const;

/** Stat result structure layout */
const StatLayout = {
  IS_FILE: 0,
  IS_DIRECTORY: 1,
  IS_SYMLINK: 2,
  MODE: 4,
  SIZE: 8,
  MTIME: 16,
  TOTAL: 24,
} as const;

/** Create a new SharedArrayBuffer for the protocol */
export function createSharedBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(Size.TOTAL);
}

/**
 * Helper class for reading/writing protocol data
 */
export class ProtocolBuffer {
  private int32View: Int32Array;
  private uint8View: Uint8Array;
  private dataView: DataView;

  constructor(buffer: SharedArrayBuffer) {
    this.int32View = new Int32Array(buffer);
    this.uint8View = new Uint8Array(buffer);
    this.dataView = new DataView(buffer);
  }

  getOpCode(): OpCodeType {
    return Atomics.load(this.int32View, Offset.OP_CODE / 4) as OpCodeType;
  }

  setOpCode(code: OpCodeType): void {
    Atomics.store(this.int32View, Offset.OP_CODE / 4, code);
  }

  getStatus(): StatusType {
    return Atomics.load(this.int32View, Offset.STATUS / 4) as StatusType;
  }

  setStatus(status: StatusType): void {
    Atomics.store(this.int32View, Offset.STATUS / 4, status);
  }

  getPathLength(): number {
    return Atomics.load(this.int32View, Offset.PATH_LENGTH / 4);
  }

  setPathLength(length: number): void {
    Atomics.store(this.int32View, Offset.PATH_LENGTH / 4, length);
  }

  getDataLength(): number {
    return Atomics.load(this.int32View, Offset.DATA_LENGTH / 4);
  }

  setDataLength(length: number): void {
    Atomics.store(this.int32View, Offset.DATA_LENGTH / 4, length);
  }

  getResultLength(): number {
    return Atomics.load(this.int32View, Offset.RESULT_LENGTH / 4);
  }

  setResultLength(length: number): void {
    Atomics.store(this.int32View, Offset.RESULT_LENGTH / 4, length);
  }

  getErrorCode(): ErrorCodeType {
    return Atomics.load(this.int32View, Offset.ERROR_CODE / 4) as ErrorCodeType;
  }

  setErrorCode(code: ErrorCodeType): void {
    Atomics.store(this.int32View, Offset.ERROR_CODE / 4, code);
  }

  getFlags(): number {
    return Atomics.load(this.int32View, Offset.FLAGS / 4);
  }

  setFlags(flags: number): void {
    Atomics.store(this.int32View, Offset.FLAGS / 4, flags);
  }

  getMode(): number {
    return Atomics.load(this.int32View, Offset.MODE / 4);
  }

  setMode(mode: number): void {
    Atomics.store(this.int32View, Offset.MODE / 4, mode);
  }

  getPath(): string {
    const length = this.getPathLength();
    const bytes = this.uint8View.slice(
      Offset.PATH_BUFFER,
      Offset.PATH_BUFFER + length,
    );
    return new TextDecoder().decode(bytes);
  }

  setPath(path: string): void {
    const encoded = new TextEncoder().encode(path);
    if (encoded.length > Size.PATH_BUFFER) {
      throw new Error(`Path too long: ${encoded.length} > ${Size.PATH_BUFFER}`);
    }
    this.uint8View.set(encoded, Offset.PATH_BUFFER);
    this.setPathLength(encoded.length);
  }

  getData(): Uint8Array {
    const length = this.getDataLength();
    return this.uint8View.slice(
      Offset.DATA_BUFFER,
      Offset.DATA_BUFFER + length,
    );
  }

  setData(data: Uint8Array): void {
    if (data.length > Size.DATA_BUFFER) {
      throw new Error(`Data too large: ${data.length} > ${Size.DATA_BUFFER}`);
    }
    this.uint8View.set(data, Offset.DATA_BUFFER);
    this.setDataLength(data.length);
  }

  getDataAsString(): string {
    const data = this.getData();
    return new TextDecoder().decode(data);
  }

  setDataFromString(str: string): void {
    const encoded = new TextEncoder().encode(str);
    this.setData(encoded);
  }

  getResult(): Uint8Array {
    const length = this.getResultLength();
    return this.uint8View.slice(
      Offset.DATA_BUFFER,
      Offset.DATA_BUFFER + length,
    );
  }

  setResult(data: Uint8Array): void {
    if (data.length > Size.DATA_BUFFER) {
      throw new Error(`Result too large: ${data.length} > ${Size.DATA_BUFFER}`);
    }
    this.uint8View.set(data, Offset.DATA_BUFFER);
    this.setResultLength(data.length);
  }

  getResultAsString(): string {
    const result = this.getResult();
    return new TextDecoder().decode(result);
  }

  setResultFromString(str: string): void {
    const encoded = new TextEncoder().encode(str);
    this.setResult(encoded);
  }

  encodeStat(stat: {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode: number;
    size: number;
    mtime: Date;
  }): void {
    this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_FILE] = stat.isFile
      ? 1
      : 0;
    this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_DIRECTORY] =
      stat.isDirectory ? 1 : 0;
    this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_SYMLINK] =
      stat.isSymbolicLink ? 1 : 0;
    this.dataView.setInt32(
      Offset.DATA_BUFFER + StatLayout.MODE,
      stat.mode,
      true,
    );
    const size = Math.min(stat.size, Number.MAX_SAFE_INTEGER);
    this.dataView.setFloat64(Offset.DATA_BUFFER + StatLayout.SIZE, size, true);
    this.dataView.setFloat64(
      Offset.DATA_BUFFER + StatLayout.MTIME,
      stat.mtime.getTime(),
      true,
    );
    this.setResultLength(StatLayout.TOTAL);
  }

  decodeStat(): {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode: number;
    size: number;
    mtime: Date;
  } {
    return {
      isFile: this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_FILE] === 1,
      isDirectory:
        this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_DIRECTORY] === 1,
      isSymbolicLink:
        this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_SYMLINK] === 1,
      mode: this.dataView.getInt32(Offset.DATA_BUFFER + StatLayout.MODE, true),
      size: this.dataView.getFloat64(
        Offset.DATA_BUFFER + StatLayout.SIZE,
        true,
      ),
      mtime: new Date(
        this.dataView.getFloat64(Offset.DATA_BUFFER + StatLayout.MTIME, true),
      ),
    };
  }

  waitForReady(timeout?: number): "ok" | "timed-out" | "not-equal" {
    return Atomics.wait(
      this.int32View,
      Offset.STATUS / 4,
      Status.PENDING,
      timeout,
    );
  }

  waitForReadyAsync(
    timeout?: number,
  ):
    | { async: false; value: "not-equal" | "timed-out" }
    | { async: true; value: Promise<"ok" | "timed-out"> } {
    // Wait for status to change from PENDING (any change means worker set READY)
    return Atomics.waitAsync(
      this.int32View,
      Offset.STATUS / 4,
      Status.PENDING,
      timeout,
    );
  }

  /**
   * Wait for status to become READY.
   * Returns immediately if status is already READY, or waits until it changes.
   */
  async waitUntilReady(timeout: number): Promise<boolean> {
    const startTime = Date.now();

    while (true) {
      const status = this.getStatus();
      if (status === Status.READY) {
        return true;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        return false;
      }

      // Wait for any status change
      const remainingMs = timeout - elapsed;
      const result = Atomics.waitAsync(
        this.int32View,
        Offset.STATUS / 4,
        status,
        remainingMs,
      );

      if (result.async) {
        const waitResult = await result.value;
        if (waitResult === "timed-out") {
          return false;
        }
      }
      // Re-check status after wait
    }
  }

  waitForResult(timeout?: number): "ok" | "timed-out" | "not-equal" {
    return Atomics.wait(
      this.int32View,
      Offset.STATUS / 4,
      Status.READY,
      timeout,
    );
  }

  notify(): number {
    return Atomics.notify(this.int32View, Offset.STATUS / 4);
  }

  reset(): void {
    this.setOpCode(OpCode.NOOP);
    this.setStatus(Status.PENDING);
    this.setPathLength(0);
    this.setDataLength(0);
    this.setResultLength(0);
    this.setErrorCode(ErrorCode.NONE);
    this.setFlags(Flags.NONE);
    this.setMode(0);
  }
}
