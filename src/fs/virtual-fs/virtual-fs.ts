/**
 * IFileSystem backed by user-provided async hooks.
 *
 * Content is generated on the fly by a {@link VirtualFsSource} —
 * the filesystem never stores anything itself.  Write operations
 * delegate to optional source hooks or reject with EROFS.
 */

import { fromBuffer, getEncoding, toBuffer } from "../encoding.js";
import type {
  BufferEncoding,
  DirentEntry,
  FsStat,
  IFileSystem,
  ReadFileOptions,
} from "../interface.js";
import {
  DEFAULT_DIR_MODE,
  DEFAULT_FILE_MODE,
  normalizePath,
  resolvePath,
  validatePath,
} from "../path-utils.js";

const textEncoder = new TextEncoder();

/** Simplified DirentEntry without isSymbolicLink, used by source hooks. */
export type VirtualDirent = Omit<DirentEntry, "isSymbolicLink">;

/** Optional write hooks — signatures picked straight from {@link IFileSystem}. */
export type VirtualFsWriteHooks = Partial<Pick<IFileSystem,
  "writeFile" | "appendFile" | "mkdir" | "rm" |
  "cp" | "mv" | "chmod" | "symlink" | "link" | "utimes"
>>;

/**
 * Async hooks that drive a {@link VirtualFs}.
 *
 * Only {@link readFile} and {@link readdir} are required.
 * `stat` and `exists` are derived automatically when not provided.
 * Write hooks are optional — absent hooks reject with EROFS.
 */
export interface VirtualFsSource extends VirtualFsWriteHooks {
  /** Return file content or `null` when the path does not exist. */
  readFile(path: string): Promise<string | Uint8Array | null>;

  /** Return directory entries or `null` when the path is not a directory. */
  readdir(path: string): Promise<VirtualDirent[] | null>;

  /** Optional — derived from readdir/readFile when absent. */
  stat?(path: string): Promise<FsStat | null>;

  /** Optional — derived from stat when absent. Same contract as {@link IFileSystem.exists}. */
  exists?: IFileSystem["exists"];

  /** Called by {@link VirtualFs.dispose} to release external resources. */
  dispose?(): Promise<void>;
}

/** Create a typed factory for virtual filesystem sources. */
export function defineVirtualFs<T>(
  factory: (options: T) => VirtualFsSource,
): (options: T) => VirtualFsSource {
  return factory;
}

/**
 * {@link IFileSystem} whose content is generated at runtime
 * by a pluggable {@link VirtualFsSource}.
 *
 * Write operations delegate to optional source hooks or reject with EROFS.
 * Typically mounted inside a {@link MountableFs} so the shell can
 * access the virtual tree with standard bash commands.
 */
export class VirtualFs implements IFileSystem {
  private source: VirtualFsSource;

  constructor(source: VirtualFsSource) {
    this.source = source;
  }

  // ── reads ────────────────────────────────────────────────

  async readFile(
    path: string,
    options?: ReadFileOptions | BufferEncoding,
  ): Promise<string> {
    const content = await this.fetchContent(path);
    return content instanceof Uint8Array
      ? fromBuffer(content, getEncoding(options))
      : content;
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const content = await this.fetchContent(path);
    return content instanceof Uint8Array ? content : toBuffer(content);
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.fetchEntries(path);
    return entries.map((e) => e.name).sort();
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const entries = await this.fetchEntries(path);
    return entries
      .map((e) => ({ ...e, isSymbolicLink: false }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── stat / exists ────────────────────────────────────────

  async stat(path: string): Promise<FsStat> {
    const normalized = this.normalize(path);

    // User-provided stat takes precedence
    if (this.source.stat) {
      const result = await this.source.stat(normalized);
      if (result) return result;
      if (normalized === "/") return this.dirStat();
      throw new Error(
        `ENOENT: no such file or directory, stat '${path}'`,
      );
    }

    // Root is always a directory
    if (normalized === "/") return this.dirStat();

    // Derive from readdir (directory?) then readFile (file?)
    const entries = await this.source.readdir(normalized);
    if (entries !== null) return this.dirStat();

    const content = await this.source.readFile(normalized);
    if (content !== null) {
      const size =
        typeof content === "string"
          ? textEncoder.encode(content).length
          : content.length;
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mode: DEFAULT_FILE_MODE,
        size,
        mtime: new Date(),
      };
    }

    throw new Error(
      `ENOENT: no such file or directory, stat '${path}'`,
    );
  }

  async lstat(path: string): Promise<FsStat> {
    return this.stat(path);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalize(path);
    if (this.source.exists) {
      return this.source.exists(normalized);
    }
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  // ── path helpers ─────────────────────────────────────────

  resolvePath(base: string, path: string): string {
    return resolvePath(base, path);
  }

  getAllPaths(): string[] {
    return [];
  }

  async realpath(path: string): Promise<string> {
    const normalized = this.normalize(path);
    await this.stat(path);
    return normalized;
  }

  // ── write ops — delegate to source hook or reject with EROFS ──

  writeFile(...args: Parameters<IFileSystem["writeFile"]>): Promise<void> {
    return this.source.writeFile ? this.source.writeFile(...args) : Promise.reject(this.readOnlyError("writeFile"));
  }
  appendFile(...args: Parameters<IFileSystem["appendFile"]>): Promise<void> {
    return this.source.appendFile ? this.source.appendFile(...args) : Promise.reject(this.readOnlyError("appendFile"));
  }
  mkdir(...args: Parameters<IFileSystem["mkdir"]>): Promise<void> {
    return this.source.mkdir ? this.source.mkdir(...args) : Promise.reject(this.readOnlyError("mkdir"));
  }
  rm(...args: Parameters<IFileSystem["rm"]>): Promise<void> {
    return this.source.rm ? this.source.rm(...args) : Promise.reject(this.readOnlyError("rm"));
  }
  cp(...args: Parameters<IFileSystem["cp"]>): Promise<void> {
    return this.source.cp ? this.source.cp(...args) : Promise.reject(this.readOnlyError("cp"));
  }
  mv(...args: Parameters<IFileSystem["mv"]>): Promise<void> {
    return this.source.mv ? this.source.mv(...args) : Promise.reject(this.readOnlyError("mv"));
  }
  chmod(...args: Parameters<IFileSystem["chmod"]>): Promise<void> {
    return this.source.chmod ? this.source.chmod(...args) : Promise.reject(this.readOnlyError("chmod"));
  }
  symlink(...args: Parameters<IFileSystem["symlink"]>): Promise<void> {
    return this.source.symlink ? this.source.symlink(...args) : Promise.reject(this.readOnlyError("symlink"));
  }
  link(...args: Parameters<IFileSystem["link"]>): Promise<void> {
    return this.source.link ? this.source.link(...args) : Promise.reject(this.readOnlyError("link"));
  }
  utimes(...args: Parameters<IFileSystem["utimes"]>): Promise<void> {
    return this.source.utimes ? this.source.utimes(...args) : Promise.reject(this.readOnlyError("utimes"));
  }

  readlink(path: string): Promise<string> {
    return Promise.reject(new Error(`EINVAL: invalid argument, readlink '${path}'`));
  }

  // ── lifecycle ────────────────────────────────────────────

  /** Release resources held by the underlying source. */
  async dispose(): Promise<void> {
    if (this.source.dispose) {
      await this.source.dispose();
    }
  }

  // ── private ──────────────────────────────────────────────

  private async fetchContent(path: string): Promise<string | Uint8Array> {
    const normalized = this.normalize(path);
    const content = await this.source.readFile(normalized);
    if (content === null) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  private async fetchEntries(path: string): Promise<VirtualDirent[]> {
    const normalized = this.normalize(path);
    const entries = await this.source.readdir(normalized);
    if (entries === null) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }
    return entries;
  }

  private normalize(path: string): string {
    validatePath(path, "access");
    return normalizePath(path);
  }

  private dirStat(): FsStat {
    return {
      isFile: false,
      isDirectory: true,
      isSymbolicLink: false,
      mode: DEFAULT_DIR_MODE,
      size: 0,
      mtime: new Date(),
    };
  }

  private readOnlyError(operation: string): Error {
    return new Error(`EROFS: read-only file system, ${operation}`);
  }
}
