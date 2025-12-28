/**
 * AgentFs - Read-write filesystem backed by AgentFS (Turso)
 *
 * Full read-write filesystem that persists to an AgentFS SQLite database.
 * Designed for AI agents needing persistent, auditable file storage.
 *
 * This is a thin wrapper around AgentFS - directories are created implicitly
 * when writing files. No in-memory tracking.
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
  agent: AgentFsHandle;

  /**
   * The virtual mount point for the filesystem.
   * Defaults to "/".
   */
  mountPoint?: string;
}

/** Default mount point for AgentFs */
const DEFAULT_MOUNT_POINT = "/";

export class AgentFs implements IFileSystem {
  private readonly agent: AgentFsHandle;
  private readonly mountPoint: string;

  constructor(options: AgentFsOptions) {
    this.agent = options.agent;

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
      const data = await this.agent.fs.readFile(agentPath);
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
    await this.agent.fs.writeFile(agentPath, Buffer.from(buffer));
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
      await this.agent.fs.stat(agentPath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FsStat> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);

    try {
      const stats = await this.agent.fs.stat(agentPath);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymbolicLink: false,
        mode: stats.mode ?? 0o644,
        size: stats.size,
        mtime: stats.mtime ? new Date(stats.mtime * 1000) : new Date(),
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
    // AgentFS doesn't support symlinks, so lstat === stat
    return this.stat(path);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const normalized = this.normalizePath(path);

    // Check if it exists
    const pathExists = await this.exists(normalized);
    if (pathExists) {
      if (!options?.recursive) {
        throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
      }
      return;
    }

    // Check parent exists (unless recursive)
    const parent = this.dirname(normalized);
    if (parent !== "/") {
      const parentExists = await this.exists(parent);
      if (!parentExists) {
        if (options?.recursive) {
          await this.mkdir(parent, { recursive: true });
        } else {
          throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
        }
      }
    }

    // AgentFS creates directories implicitly when writing files.
    // To create an empty directory, we write a marker file and delete it,
    // which should create the directory in AgentFS.
    const markerPath = `${normalized}/.agentfs-mkdir-marker`;
    await this.writeFile(markerPath, "");
    try {
      await this.agent.fs.deleteFile(this.toAgentPath(markerPath));
    } catch {
      // Ignore - the directory exists now
    }
  }

  async readdir(path: string): Promise<string[]> {
    const normalized = this.normalizePath(path);
    const agentPath = this.toAgentPath(normalized);

    try {
      const entries = await this.agent.fs.readdir(agentPath);
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

    const pathExists = await this.exists(normalized);
    if (!pathExists) {
      if (options?.force) return;
      throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
    }

    // Check if it's a directory
    const stats = await this.stat(normalized);
    if (stats.isDirectory) {
      const children = await this.readdir(normalized);
      if (children.length > 0) {
        if (!options?.recursive) {
          throw new Error(`ENOTEMPTY: directory not empty, rm '${path}'`);
        }
        for (const child of children) {
          const childPath =
            normalized === "/" ? `/${child}` : `${normalized}/${child}`;
          await this.rm(childPath, options);
        }
      }
      // AgentFS may keep the directory around - that's fine
      return;
    }

    // It's a file - delete via AgentFS
    try {
      await this.agent.fs.deleteFile(agentPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not found") || msg.includes("ENOENT")) {
        if (!options?.force) {
          throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
        }
      } else {
        throw e;
      }
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const srcNorm = this.normalizePath(src);
    const destNorm = this.normalizePath(dest);

    const srcExists = await this.exists(srcNorm);
    if (!srcExists) {
      throw new Error(`ENOENT: no such file or directory, cp '${src}'`);
    }

    const srcStat = await this.stat(srcNorm);

    if (srcStat.isFile) {
      const content = await this.readFileBuffer(srcNorm);
      await this.writeFile(destNorm, content);
    } else if (srcStat.isDirectory) {
      if (!options?.recursive) {
        throw new Error(`EISDIR: is a directory, cp '${src}'`);
      }
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
    // AgentFS doesn't have rename, so we cp + rm
    await this.cp(src, dest, { recursive: true });
    await this.rm(src, { recursive: true });
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
    // This would require scanning the entire filesystem
    return [];
  }

  async chmod(path: string, mode: number): Promise<void> {
    const normalized = this.normalizePath(path);

    const pathExists = await this.exists(normalized);
    if (!pathExists) {
      throw new Error(`ENOENT: no such file or directory, chmod '${path}'`);
    }

    // AgentFS doesn't support chmod - this is a no-op
    // but we validate the path exists
    void mode;
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const normalized = this.normalizePath(linkPath);

    const pathExists = await this.exists(normalized);
    if (pathExists) {
      throw new Error(`EEXIST: file already exists, symlink '${linkPath}'`);
    }

    // AgentFS doesn't support symlinks natively
    // Create a special file that acts like a symlink
    const content = JSON.stringify({ __symlink: target });
    await this.writeFile(normalized, content);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    const existingNorm = this.normalizePath(existingPath);
    const newNorm = this.normalizePath(newPath);

    const existingExists = await this.exists(existingNorm);
    if (!existingExists) {
      throw new Error(
        `ENOENT: no such file or directory, link '${existingPath}'`,
      );
    }

    const existingStat = await this.stat(existingNorm);
    if (!existingStat.isFile) {
      throw new Error(`EPERM: operation not permitted, link '${existingPath}'`);
    }

    const newExists = await this.exists(newNorm);
    if (newExists) {
      throw new Error(`EEXIST: file already exists, link '${newPath}'`);
    }

    // Copy content to new location (AgentFS doesn't support hard links)
    const content = await this.readFileBuffer(existingNorm);
    await this.writeFile(newNorm, content);
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
