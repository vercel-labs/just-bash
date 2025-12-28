/**
 * AgentFs - Read-write filesystem backed by AgentFS (Turso)
 *
 * Full read-write filesystem that persists to an AgentFS SQLite database.
 * Designed for AI agents needing persistent, auditable file storage.
 *
 * This is a thin wrapper around AgentFS - uses native mkdir, rm, rename, etc.
 *
 * @see https://docs.turso.tech/agentfs/sdk/typescript
 */

import type { Filesystem } from "agentfs-sdk";
import type {
  BufferEncoding,
  CpOptions,
  FsStat,
  IFileSystem,
  MkdirOptions,
  ReadFileOptions,
  RmOptions,
  WriteFileOptions,
} from "../fs-interface.js";

// Text encoder/decoder for encoding conversions
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type FileContent = string | Uint8Array;

/**
 * Helper to convert content to Uint8Array
 */
function toBuffer(content: FileContent, encoding?: BufferEncoding): Uint8Array {
  if (content instanceof Uint8Array) {
    return content;
  }

  switch (encoding) {
    case "base64":
      return Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
    case "hex": {
      const bytes = new Uint8Array(content.length / 2);
      for (let i = 0; i < content.length; i += 2) {
        bytes[i / 2] = parseInt(content.slice(i, i + 2), 16);
      }
      return bytes;
    }
    case "binary":
    case "latin1":
      return Uint8Array.from(content, (c) => c.charCodeAt(0));
    default:
      return textEncoder.encode(content);
  }
}

/**
 * Helper to convert Uint8Array to string with encoding
 */
function fromBuffer(
  buffer: Uint8Array,
  encoding?: BufferEncoding | null,
): string {
  switch (encoding) {
    case "base64":
      return btoa(String.fromCharCode(...buffer));
    case "hex":
      return Array.from(buffer)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    case "binary":
    case "latin1":
      return String.fromCharCode(...buffer);
    default:
      return textDecoder.decode(buffer);
  }
}

function getEncoding(
  options?: ReadFileOptions | WriteFileOptions | BufferEncoding | null,
): BufferEncoding | undefined {
  if (options === null || options === undefined) {
    return undefined;
  }
  if (typeof options === "string") {
    return options;
  }
  return options.encoding ?? undefined;
}

/**
 * Handle to an AgentFS instance (from AgentFS.open())
 */
export interface AgentFsHandle {
  fs: Filesystem;
}

export interface AgentFsOptions {
  /**
   * The AgentFS handle from AgentFS.open()
   */
  fs: AgentFsHandle;

  /**
   * The virtual mount point for the filesystem.
   * Defaults to "/".
   */
  mountPoint?: string;
}

/** Default mount point for AgentFs */
const DEFAULT_MOUNT_POINT = "/";

export class AgentFs implements IFileSystem {
  private readonly agentFs: Filesystem;
  private readonly mountPoint: string;

  constructor(options: AgentFsOptions) {
    this.agentFs = options.fs.fs;

    // Normalize mount point
    const mp = options.mountPoint ?? DEFAULT_MOUNT_POINT;
    this.mountPoint = mp === "/" ? "/" : mp.replace(/\/+$/, "");
    if (!this.mountPoint.startsWith("/")) {
      throw new Error(`Mount point must be an absolute path: ${mp}`);
    }
  }

  /**
   * Get the mount point for this filesystem
   */
  getMountPoint(): string {
    return this.mountPoint;
  }

  /**
   * Normalize a virtual path (resolve . and .., ensure starts with /)
   */
  private normalizePath(path: string): string {
    if (!path || path === "/") return "/";

    let normalized =
      path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;

    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }

    const parts = normalized.split("/").filter((p) => p && p !== ".");
    const resolved: string[] = [];

    for (const part of parts) {
      if (part === "..") {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    return `/${resolved.join("/")}` || "/";
  }

  /**
   * Convert virtual path to AgentFS path (strip mount point prefix)
   */
  private toAgentPath(virtualPath: string): string {
    const normalized = this.normalizePath(virtualPath);

    if (this.mountPoint === "/") {
      return normalized;
    }

    if (normalized === this.mountPoint) {
      return "/";
    }

    if (normalized.startsWith(`${this.mountPoint}/`)) {
      return normalized.slice(this.mountPoint.length);
    }

    // Path is outside mount point
    return normalized;
  }

  private dirname(path: string): string {
    const normalized = this.normalizePath(path);
    if (normalized === "/") return "/";
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === 0 ? "/" : normalized.slice(0, lastSlash);
  }

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const buffer = await this.readFileBuffer(path);
    const encoding = getEncoding(options);
    return fromBuffer(buffer, encoding);
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);

    try {
      const data = await this.agentFs.readFile(agentPath);
      if (typeof data === "string") {
        return textEncoder.encode(data);
      }
      return new Uint8Array(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found") || msg.includes("ENOENT")) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      throw e;
    }
  }

  async writeFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    const normalized = this.normalizePath(path);
    const encoding = getEncoding(options);
    const buffer = toBuffer(content, encoding);
    const agentPath = this.toAgentPath(normalized);
    // AgentFS creates parent directories implicitly
    await this.agentFs.writeFile(agentPath, Buffer.from(buffer));
  }

  async appendFile(
    path: string,
    content: FileContent,
    options?: WriteFileOptions | BufferEncoding,
  ): Promise<void> {
    const normalized = this.normalizePath(path);
    const encoding = getEncoding(options);
    const newBuffer = toBuffer(content, encoding);

    // Try to read existing content
    let existingBuffer: Uint8Array;
    try {
      existingBuffer = await this.readFileBuffer(normalized);
    } catch {
      existingBuffer = new Uint8Array(0);
    }

    const combined = new Uint8Array(existingBuffer.length + newBuffer.length);
    combined.set(existingBuffer);
    combined.set(newBuffer, existingBuffer.length);

    await this.writeFile(normalized, combined);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);
    try {
      await this.agentFs.access(agentPath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FsStat> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);

    try {
      const stats = await this.agentFs.stat(agentPath);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink(),
        mode: stats.mode,
        size: stats.size,
        mtime: new Date(stats.mtime * 1000),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found") || msg.includes("ENOENT")) {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
      throw e;
    }
  }

  async lstat(path: string): Promise<FsStat> {
    // AgentFS stat doesn't follow symlinks by default
    return this.stat(path);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);

    if (options?.recursive) {
      // Create parent directories first
      const parent = this.dirname(normalized);
      if (parent !== "/" && parent !== normalized) {
        const parentExists = await this.exists(parent);
        if (!parentExists) {
          await this.mkdir(parent, { recursive: true });
        }
      }
    }

    try {
      await this.agentFs.mkdir(agentPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("EEXIST") || msg.includes("already exists")) {
        if (!options?.recursive) {
          throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
        }
        // With recursive, existing dir is ok
        return;
      }
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
      }
      throw e;
    }
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);

    try {
      const entries = await this.agentFs.readdir(agentPath);
      return entries.sort();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found") || msg.includes("ENOENT")) {
        throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      }
      throw e;
    }
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);

    try {
      await this.agentFs.rm(agentPath, {
        force: options?.force,
        recursive: options?.recursive,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        if (!options?.force) {
          throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
        }
        return;
      }
      if (msg.includes("ENOTEMPTY") || msg.includes("not empty")) {
        throw new Error(`ENOTEMPTY: directory not empty, rm '${path}'`);
      }
      if (msg.includes("EISDIR")) {
        // Directory without recursive - try rmdir for empty directories
        try {
          await this.agentFs.rmdir(agentPath);
          return;
        } catch (rmdirErr) {
          const rmdirMsg =
            rmdirErr instanceof Error ? rmdirErr.message : String(rmdirErr);
          if (
            rmdirMsg.includes("ENOTEMPTY") ||
            rmdirMsg.includes("not empty")
          ) {
            throw new Error(`ENOTEMPTY: directory not empty, rm '${path}'`);
          }
          throw rmdirErr;
        }
      }
      throw e;
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const srcNorm = this.normalizePath(src);
    const destNorm = this.normalizePath(dest);
    const srcAgent = this.toAgentPath(srcNorm);
    const destAgent = this.toAgentPath(destNorm);

    const srcStat = await this.stat(srcNorm);

    if (srcStat.isFile) {
      // Use native copyFile for files
      await this.agentFs.copyFile(srcAgent, destAgent);
    } else if (srcStat.isDirectory) {
      if (!options?.recursive) {
        throw new Error(`EISDIR: is a directory, cp '${src}'`);
      }
      // Recursively copy directory
      await this.mkdir(destNorm, { recursive: true });
      const children = await this.readdir(srcNorm);
      for (const child of children) {
        const srcChild = srcNorm === "/" ? `/${child}` : `${srcNorm}/${child}`;
        const destChild =
          destNorm === "/" ? `/${child}` : `${destNorm}/${child}`;
        await this.cp(srcChild, destChild, options);
      }
    }
  }

  async mv(src: string, dest: string): Promise<void> {
    const srcNorm = this.normalizePath(src);
    const destNorm = this.normalizePath(dest);
    const srcAgent = this.toAgentPath(srcNorm);
    const destAgent = this.toAgentPath(destNorm);

    try {
      await this.agentFs.rename(srcAgent, destAgent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ENOENT") || msg.includes("not found")) {
        throw new Error(`ENOENT: no such file or directory, mv '${src}'`);
      }
      throw e;
    }
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) {
      return this.normalizePath(path);
    }
    const combined = base === "/" ? `/${path}` : `${base}/${path}`;
    return this.normalizePath(combined);
  }

  getAllPaths(): string[] {
    // AgentFS doesn't provide a way to list all paths efficiently
    return [];
  }

  async chmod(path: string, mode: number): Promise<void> {
    const normalized = this.normalizePath(path);

    // Verify path exists
    const pathExists = await this.exists(normalized);
    if (!pathExists) {
      throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
    }

    // AgentFS doesn't support chmod yet - this is a no-op
    void mode;
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const normalized = this.normalizePath(linkPath);

    const pathExists = await this.exists(normalized);
    if (pathExists) {
      throw new Error(`EEXIST: file already exists, symlink '${linkPath}'`);
    }

    // AgentFS doesn't support symlinks natively yet
    // Create a special file that acts like a symlink
    const content = JSON.stringify({ __symlink: target });
    await this.writeFile(normalized, content);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const existingNorm = this.normalizePath(existingPath);
    const newNorm = this.normalizePath(newPath);
    const existingAgent = this.toAgentPath(existingNorm);
    const newAgent = this.toAgentPath(newNorm);

    const existingStat = await this.stat(existingNorm);
    if (!existingStat.isFile) {
      throw new Error(`EPERM: operation not permitted, link '${existingPath}'`);
    }

    const newExists = await this.exists(newNorm);
    if (newExists) {
      throw new Error(`EEXIST: file already exists, link '${newPath}'`);
    }

    // Use copyFile for hard link emulation
    await this.agentFs.copyFile(existingAgent, newAgent);
  }

  async readlink(path: string): Promise<string> {
    const normalized = this.normalizePath(path);

    const pathExists = await this.exists(normalized);
    if (!pathExists) {
      throw new Error(`ENOENT: no such file or directory, readlink '${path}'`);
    }

    // Try to read as symlink (our special JSON format)
    try {
      const content = await this.readFile(normalized);
      const parsed = JSON.parse(content);
      if (parsed.__symlink) {
        return parsed.__symlink;
      }
    } catch {
      // Not a symlink
    }

    throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
  }
}
