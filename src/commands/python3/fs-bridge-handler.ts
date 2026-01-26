/**
 * Main thread filesystem bridge handler
 *
 * Runs on the main thread and processes filesystem requests from the worker thread.
 * Uses SharedArrayBuffer + Atomics for synchronization.
 */

import type { IFileSystem } from "../../fs/interface.js";
import type { SecureFetch } from "../../network/fetch.js";
import {
  ErrorCode,
  type ErrorCodeType,
  Flags,
  OpCode,
  type OpCodeType,
  ProtocolBuffer,
  Status,
} from "./protocol.js";

export interface FsBridgeOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Handles filesystem requests from the worker thread.
 */
export class FsBridgeHandler {
  private protocol: ProtocolBuffer;
  private running = false;
  private output: FsBridgeOutput = { stdout: "", stderr: "", exitCode: 0 };

  constructor(
    sharedBuffer: SharedArrayBuffer,
    private fs: IFileSystem,
    private cwd: string,
    private secureFetch: SecureFetch | undefined = undefined,
  ) {
    this.protocol = new ProtocolBuffer(sharedBuffer);
  }

  /**
   * Run the handler loop until EXIT operation or timeout.
   */
  async run(timeoutMs: number): Promise<FsBridgeOutput> {
    this.running = true;
    const startTime = Date.now();

    while (this.running) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        this.output.stderr += "\npython3: execution timeout exceeded\n";
        this.output.exitCode = 124;
        break;
      }

      // Wait for worker to set status to READY
      const remainingMs = timeoutMs - elapsed;
      const ready = await this.protocol.waitUntilReady(remainingMs);
      if (!ready) {
        this.output.stderr += "\npython3: execution timeout exceeded\n";
        this.output.exitCode = 124;
        break;
      }

      const opCode = this.protocol.getOpCode();
      await this.handleOperation(opCode);

      // handleOperation sets status to SUCCESS/ERROR
      // Notify worker so it wakes up and sees the result
      this.protocol.notify();
    }

    return this.output;
  }

  stop(): void {
    this.running = false;
  }

  private async handleOperation(opCode: OpCodeType): Promise<void> {
    try {
      switch (opCode) {
        case OpCode.READ_FILE:
          await this.handleReadFile();
          break;
        case OpCode.WRITE_FILE:
          await this.handleWriteFile();
          break;
        case OpCode.STAT:
          await this.handleStat();
          break;
        case OpCode.LSTAT:
          await this.handleLstat();
          break;
        case OpCode.READDIR:
          await this.handleReaddir();
          break;
        case OpCode.MKDIR:
          await this.handleMkdir();
          break;
        case OpCode.RM:
          await this.handleRm();
          break;
        case OpCode.EXISTS:
          await this.handleExists();
          break;
        case OpCode.APPEND_FILE:
          await this.handleAppendFile();
          break;
        case OpCode.SYMLINK:
          await this.handleSymlink();
          break;
        case OpCode.READLINK:
          await this.handleReadlink();
          break;
        case OpCode.CHMOD:
          await this.handleChmod();
          break;
        case OpCode.REALPATH:
          await this.handleRealpath();
          break;
        case OpCode.WRITE_STDOUT:
          this.handleWriteStdout();
          break;
        case OpCode.WRITE_STDERR:
          this.handleWriteStderr();
          break;
        case OpCode.EXIT:
          this.handleExit();
          break;
        case OpCode.HTTP_REQUEST:
          await this.handleHttpRequest();
          break;
        default:
          this.protocol.setErrorCode(ErrorCode.IO_ERROR);
          this.protocol.setStatus(Status.ERROR);
      }
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private resolvePath(path: string): string {
    if (path.startsWith("/mnt/host/")) {
      return path.slice("/mnt/host".length);
    }
    if (path.startsWith("/mnt/host")) {
      return path.slice("/mnt/host".length) || "/";
    }
    return this.fs.resolvePath(this.cwd, path);
  }

  private async handleReadFile(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    try {
      const content = await this.fs.readFileBuffer(path);
      this.protocol.setResult(content);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleWriteFile(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    const data = this.protocol.getData();
    try {
      await this.fs.writeFile(path, data);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleStat(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    try {
      const stat = await this.fs.stat(path);
      this.protocol.encodeStat(stat);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleLstat(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    try {
      const stat = await this.fs.lstat(path);
      this.protocol.encodeStat(stat);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleReaddir(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    try {
      const entries = await this.fs.readdir(path);
      this.protocol.setResultFromString(JSON.stringify(entries));
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleMkdir(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    const flags = this.protocol.getFlags();
    const recursive = (flags & Flags.MKDIR_RECURSIVE) !== 0;
    try {
      await this.fs.mkdir(path, { recursive });
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleRm(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    const flags = this.protocol.getFlags();
    const recursive = (flags & Flags.RECURSIVE) !== 0;
    const force = (flags & Flags.FORCE) !== 0;
    try {
      await this.fs.rm(path, { recursive, force });
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleExists(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    try {
      const exists = await this.fs.exists(path);
      this.protocol.setResult(new Uint8Array([exists ? 1 : 0]));
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleAppendFile(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    const data = this.protocol.getData();
    try {
      await this.fs.appendFile(path, data);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleSymlink(): Promise<void> {
    const path = this.protocol.getPath();
    const data = this.protocol.getDataAsString();
    const linkPath = this.resolvePath(path);
    try {
      await this.fs.symlink(data, linkPath);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleReadlink(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    try {
      const target = await this.fs.readlink(path);
      this.protocol.setResultFromString(target);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleChmod(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    const mode = this.protocol.getMode();
    try {
      await this.fs.chmod(path, mode);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private async handleRealpath(): Promise<void> {
    const path = this.resolvePath(this.protocol.getPath());
    try {
      const realpath = await this.fs.realpath(path);
      this.protocol.setResultFromString(realpath);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      this.setErrorFromException(e);
    }
  }

  private handleWriteStdout(): void {
    const data = this.protocol.getDataAsString();
    this.output.stdout += data;
    this.protocol.setStatus(Status.SUCCESS);
  }

  private handleWriteStderr(): void {
    const data = this.protocol.getDataAsString();
    this.output.stderr += data;
    this.protocol.setStatus(Status.SUCCESS);
  }

  private handleExit(): void {
    const exitCode = this.protocol.getFlags();
    this.output.exitCode = exitCode;
    this.protocol.setStatus(Status.SUCCESS);
    this.running = false;
  }

  private async handleHttpRequest(): Promise<void> {
    if (!this.secureFetch) {
      this.protocol.setErrorCode(ErrorCode.NETWORK_NOT_CONFIGURED);
      this.protocol.setResultFromString(
        "Network access not configured. Enable network in Bash options.",
      );
      this.protocol.setStatus(Status.ERROR);
      return;
    }

    const url = this.protocol.getPath();
    const requestJson = this.protocol.getDataAsString();

    try {
      const request = requestJson ? JSON.parse(requestJson) : {};
      const result = await this.secureFetch(url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      // Return response as JSON
      const response = JSON.stringify({
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body,
        url: result.url,
      });
      this.protocol.setResultFromString(response);
      this.protocol.setStatus(Status.SUCCESS);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.protocol.setErrorCode(ErrorCode.NETWORK_ERROR);
      this.protocol.setResultFromString(message);
      this.protocol.setStatus(Status.ERROR);
    }
  }

  private setErrorFromException(e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);

    let errorCode: ErrorCodeType = ErrorCode.IO_ERROR;
    const lowerMsg = message.toLowerCase();
    if (
      lowerMsg.includes("no such file") ||
      lowerMsg.includes("not found") ||
      lowerMsg.includes("enoent")
    ) {
      errorCode = ErrorCode.NOT_FOUND;
    } else if (
      lowerMsg.includes("is a directory") ||
      lowerMsg.includes("eisdir")
    ) {
      errorCode = ErrorCode.IS_DIRECTORY;
    } else if (
      lowerMsg.includes("not a directory") ||
      lowerMsg.includes("enotdir")
    ) {
      errorCode = ErrorCode.NOT_DIRECTORY;
    } else if (
      lowerMsg.includes("already exists") ||
      lowerMsg.includes("eexist")
    ) {
      errorCode = ErrorCode.EXISTS;
    } else if (
      lowerMsg.includes("permission") ||
      lowerMsg.includes("eperm") ||
      lowerMsg.includes("eacces")
    ) {
      errorCode = ErrorCode.PERMISSION_DENIED;
    }

    this.protocol.setErrorCode(errorCode);
    this.protocol.setResultFromString(message);
    this.protocol.setStatus(Status.ERROR);
  }
}
