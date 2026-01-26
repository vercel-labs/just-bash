/**
 * Worker-side synchronous filesystem backend
 *
 * Runs in the worker thread and makes synchronous calls to the main thread
 * via SharedArrayBuffer + Atomics.
 */

import {
  Flags,
  OpCode,
  type OpCodeType,
  ProtocolBuffer,
  Status,
} from "./protocol.js";

/**
 * Synchronous filesystem backend for Pyodide worker.
 */
export class SyncFsBackend {
  private protocol: ProtocolBuffer;

  constructor(sharedBuffer: SharedArrayBuffer) {
    this.protocol = new ProtocolBuffer(sharedBuffer);
  }

  private execSync(
    opCode: OpCodeType,
    path: string,
    data?: Uint8Array,
    flags = 0,
    mode = 0,
  ): { success: boolean; result?: Uint8Array; error?: string } {
    this.protocol.reset();
    this.protocol.setOpCode(opCode);
    this.protocol.setPath(path);
    this.protocol.setFlags(flags);
    this.protocol.setMode(mode);
    if (data) {
      this.protocol.setData(data);
    }

    this.protocol.setStatus(Status.READY);
    this.protocol.notify();

    // Wait for main thread to process (with timeout)
    const waitResult = this.protocol.waitForResult(5000);
    if (waitResult === "timed-out") {
      return { success: false, error: "Operation timed out" };
    }

    const status = this.protocol.getStatus();
    if (status === Status.SUCCESS) {
      return { success: true, result: this.protocol.getResult() };
    }
    return {
      success: false,
      error:
        this.protocol.getResultAsString() ||
        `Error code: ${this.protocol.getErrorCode()}`,
    };
  }

  readFile(path: string): Uint8Array {
    const result = this.execSync(OpCode.READ_FILE, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to read file");
    }
    return result.result ?? new Uint8Array(0);
  }

  writeFile(path: string, data: Uint8Array): void {
    const result = this.execSync(OpCode.WRITE_FILE, path, data);
    if (!result.success) {
      throw new Error(result.error || "Failed to write file");
    }
  }

  stat(path: string): {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode: number;
    size: number;
    mtime: Date;
  } {
    const result = this.execSync(OpCode.STAT, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to stat");
    }
    return this.protocol.decodeStat();
  }

  lstat(path: string): {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    mode: number;
    size: number;
    mtime: Date;
  } {
    const result = this.execSync(OpCode.LSTAT, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to lstat");
    }
    return this.protocol.decodeStat();
  }

  readdir(path: string): string[] {
    const result = this.execSync(OpCode.READDIR, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to readdir");
    }
    return JSON.parse(this.protocol.getResultAsString());
  }

  mkdir(path: string, recursive = false): void {
    const flags = recursive ? Flags.MKDIR_RECURSIVE : 0;
    const result = this.execSync(OpCode.MKDIR, path, undefined, flags);
    if (!result.success) {
      throw new Error(result.error || "Failed to mkdir");
    }
  }

  rm(path: string, recursive = false, force = false): void {
    let flags = 0;
    if (recursive) flags |= Flags.RECURSIVE;
    if (force) flags |= Flags.FORCE;
    const result = this.execSync(OpCode.RM, path, undefined, flags);
    if (!result.success) {
      throw new Error(result.error || "Failed to rm");
    }
  }

  exists(path: string): boolean {
    const result = this.execSync(OpCode.EXISTS, path);
    if (!result.success) {
      return false;
    }
    return result.result?.[0] === 1;
  }

  appendFile(path: string, data: Uint8Array): void {
    const result = this.execSync(OpCode.APPEND_FILE, path, data);
    if (!result.success) {
      throw new Error(result.error || "Failed to append file");
    }
  }

  symlink(target: string, linkPath: string): void {
    const targetData = new TextEncoder().encode(target);
    const result = this.execSync(OpCode.SYMLINK, linkPath, targetData);
    if (!result.success) {
      throw new Error(result.error || "Failed to symlink");
    }
  }

  readlink(path: string): string {
    const result = this.execSync(OpCode.READLINK, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to readlink");
    }
    return this.protocol.getResultAsString();
  }

  chmod(path: string, mode: number): void {
    const result = this.execSync(OpCode.CHMOD, path, undefined, 0, mode);
    if (!result.success) {
      throw new Error(result.error || "Failed to chmod");
    }
  }

  realpath(path: string): string {
    const result = this.execSync(OpCode.REALPATH, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to realpath");
    }
    return this.protocol.getResultAsString();
  }

  writeStdout(data: string): void {
    const encoded = new TextEncoder().encode(data);
    this.execSync(OpCode.WRITE_STDOUT, "", encoded);
  }

  writeStderr(data: string): void {
    const encoded = new TextEncoder().encode(data);
    this.execSync(OpCode.WRITE_STDERR, "", encoded);
  }

  exit(code: number): void {
    this.execSync(OpCode.EXIT, "", undefined, code);
  }

  /**
   * Make an HTTP request through the main thread's secureFetch.
   * Returns the response as a parsed object.
   */
  httpRequest(
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ): {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    url: string;
  } {
    const requestData = options
      ? new TextEncoder().encode(JSON.stringify(options))
      : undefined;
    const result = this.execSync(OpCode.HTTP_REQUEST, url, requestData);
    if (!result.success) {
      throw new Error(result.error || "HTTP request failed");
    }
    const responseJson = new TextDecoder().decode(result.result);
    return JSON.parse(responseJson);
  }
}
